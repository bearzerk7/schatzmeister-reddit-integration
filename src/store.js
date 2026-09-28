import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve("data");
const DATA_FILE = path.join(DATA_DIR, "guilds.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS = 30;

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
}

function readAll() {
  ensureFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeAll(data) {
  ensureFile();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Keep the previous valid database as a timestamped backup before replacing it.
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `guilds-${stamp}.json`));

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.endsWith(".json"))
      .sort()
      .reverse();

    for (const old of backups.slice(MAX_BACKUPS)) {
      fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
    }
  }

  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function getGuild(data, guildId) {
  if (!data[guildId]) {
    data[guildId] = {
      startingDkp: 0,
      users: {},
      transactions: [],
      codes: {}
    };
  }
  return data[guildId];
}

export function getBalance(guildId, userId, username) {
  const data = readAll();
  const guild = getGuild(data, guildId);

  if (!guild.users[userId]) {
    guild.users[userId] = {
      username,
      dkp: guild.startingDkp
    };
    writeAll(data);
  } else if (username && guild.users[userId].username !== username) {
    guild.users[userId].username = username;
    writeAll(data);
  }

  return guild.users[userId].dkp;
}

export function changeDkp(guildId, userId, username, amount, reason, actorId, actorName) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error("Der DKP-Betrag muss eine ganze Zahl ungleich 0 sein.");
  }

  const data = readAll();
  const guild = getGuild(data, guildId);

  if (!guild.users[userId]) {
    guild.users[userId] = { username, dkp: guild.startingDkp };
  }

  guild.users[userId].username = username || guild.users[userId].username;
  guild.users[userId].dkp += amount;

  const transaction = {
    id: crypto.randomUUID(),
    userId,
    username: guild.users[userId].username,
    amount,
    reason: reason || "Kein Grund angegeben",
    actorId,
    actorName,
    timestamp: new Date().toISOString()
  };

  guild.transactions.unshift(transaction);
  guild.transactions = guild.transactions.slice(0, 5000);
  writeAll(data);

  return {
    balance: guild.users[userId].dkp,
    transaction
  };
}

export function setDkp(guildId, userId, username, value, reason, actorId, actorName) {
  if (!Number.isInteger(value)) {
    throw new Error("Der DKP-Wert muss eine ganze Zahl sein.");
  }

  const data = readAll();
  const guild = getGuild(data, guildId);

  if (!guild.users[userId]) {
    guild.users[userId] = { username, dkp: guild.startingDkp };
  }

  const oldValue = guild.users[userId].dkp;
  const amount = value - oldValue;

  guild.users[userId].username = username || guild.users[userId].username;
  guild.users[userId].dkp = value;

  const transaction = {
    id: crypto.randomUUID(),
    userId,
    username: guild.users[userId].username,
    amount,
    reason: reason || "DKP direkt gesetzt",
    actorId,
    actorName,
    timestamp: new Date().toISOString()
  };

  guild.transactions.unshift(transaction);
  guild.transactions = guild.transactions.slice(0, 5000);
  writeAll(data);

  return {
    balance: value,
    transaction
  };
}

export function resetAll(guildId, actorId, actorName) {
  const data = readAll();
  const guild = getGuild(data, guildId);

  const users = Object.entries(guild.users);
  let affected = 0;

  for (const [userId, user] of users) {
    if (user.dkp === 0) continue;

    const old = user.dkp;
    user.dkp = 0;
    affected++;

    guild.transactions.unshift({
      id: crypto.randomUUID(),
      userId,
      username: user.username,
      amount: -old,
      reason: "Alle DKP zurückgesetzt",
      actorId,
      actorName,
      timestamp: new Date().toISOString()
    });
  }

  guild.transactions = guild.transactions.slice(0, 5000);
  writeAll(data);

  return affected;
}

export function getLeaderboard(guildId) {
  const data = readAll();
  const guild = getGuild(data, guildId);

  return Object.entries(guild.users)
    .map(([userId, user]) => ({ userId, ...user }))
    .sort((a, b) => b.dkp - a.dkp);
}

export function getTransactions(guildId, userId, limit = 10) {
  const data = readAll();
  const guild = getGuild(data, guildId);

  return guild.transactions
    .filter(tx => !userId || tx.userId === userId)
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

function createUniqueCode(guild) {
  let code;

  do {
    const random = crypto.randomBytes(8).toString("hex").toUpperCase();
    code = `DKP-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}`;
  } while (guild.codes[code]);

  return code;
}

export function generateCode(guildId, amount, creatorId, creatorName) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Der Code-Betrag muss eine positive ganze Zahl sein.");
  }

  const data = readAll();
  const guild = getGuild(data, guildId);
  const code = createUniqueCode(guild);

  guild.codes[code] = {
    amount,
    creatorId,
    creatorName,
    createdAt: new Date().toISOString(),
    redeemedBy: null,
    redeemedAt: null
  };

  writeAll(data);

  return code;
}

export function redeemCode(guildId, code, userId, username) {
  const data = readAll();
  const guild = getGuild(data, guildId);
  const normalized = code.trim().toUpperCase();
  const entry = guild.codes[normalized];

  if (!entry) throw new Error("Dieser DKP-Code existiert nicht.");
  if (entry.redeemedBy) throw new Error("Dieser DKP-Code wurde bereits eingelöst.");

  if (!guild.users[userId]) {
    guild.users[userId] = {
      username,
      dkp: guild.startingDkp
    };
  }

  guild.users[userId].username = username;
  guild.users[userId].dkp += entry.amount;

  entry.redeemedBy = userId;
  entry.redeemedAt = new Date().toISOString();

  guild.transactions.unshift({
    id: crypto.randomUUID(),
    userId,
    username,
    amount: entry.amount,
    reason: `Code ${normalized} eingelöst`,
    actorId: userId,
    actorName: username,
    timestamp: new Date().toISOString()
  });

  guild.transactions = guild.transactions.slice(0, 5000);
  writeAll(data);

  return {
    amount: entry.amount,
    balance: guild.users[userId].dkp
  };
}
