import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve("data");
const DATA_FILE = path.join(DATA_DIR, "polls.json");

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}", "utf8");
}

function readAll() {
  ensureFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeAll(data) {
  ensureFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

export function createPoll({ guildId, channelId, messageId, question, options, creatorId, creatorName, durationHours, allowMultiple = false }) {
  const data = readAll();
  const id = crypto.randomUUID();
  const now = new Date();
  const closesAt = durationHours ? new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString() : null;

  data[id] = {
    id,
    guildId,
    channelId,
    messageId,
    question,
    allowMultiple: Boolean(allowMultiple),
    options: options.map((label, index) => ({ id: String(index), label, votes: [] })),
    creatorId,
    creatorName,
    createdAt: now.toISOString(),
    closesAt,
    closed: false,
    closedAt: null,
    resultMessageId: null
  };

  writeAll(data);
  return data[id];
}

export function setPollMessageId(id, messageId) {
  const data = readAll();
  const poll = data[id];
  if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");
  poll.messageId = messageId;
  writeAll(data);
  return poll;
}

export function getPoll(id) {
  return readAll()[id] || null;
}

export function getAllPolls() {
  return Object.values(readAll());
}

export function votePoll(id, userId, optionId) {
  const data = readAll();
  const poll = data[id];
  if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");
  if (poll.closed) throw new Error("Diese Abstimmung ist bereits geschlossen.");
  if (poll.closesAt && Date.now() >= new Date(poll.closesAt).getTime()) {
    poll.closed = true;
    poll.closedAt = new Date().toISOString();
    writeAll(data);
    throw new Error("Diese Abstimmung ist bereits abgelaufen.");
  }

  const option = poll.options.find(item => item.id === optionId);
  if (!option) throw new Error("Diese Antwortoption existiert nicht.");

  if (poll.allowMultiple) {
    option.votes = option.votes.includes(userId)
      ? option.votes.filter(id => id !== userId)
      : [...option.votes, userId];
  } else {
    for (const item of poll.options) {
      item.votes = item.votes.filter(id => id !== userId);
    }
    option.votes.push(userId);
  }
  writeAll(data);
  return poll;
}

export function closePoll(id) {
  const data = readAll();
  const poll = data[id];
  if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");
  if (!poll.closed) {
    poll.closed = true;
    poll.closedAt = new Date().toISOString();
    writeAll(data);
  }
  return poll;
}

export function reopenPoll(id, durationHours) {
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168) {
    throw new Error("Die neue Laufzeit muss zwischen 1 und 168 Stunden liegen.");
  }
  const data = readAll();
  const poll = data[id];
  if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");
  poll.closed = false;
  poll.closedAt = null;
  poll.closesAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  poll.resultMessageId = null;
  writeAll(data);
  return poll;
}

export function setPollResultMessageId(id, messageId) {
  const data = readAll();
  const poll = data[id];
  if (!poll) throw new Error("Diese Abstimmung existiert nicht mehr.");
  poll.resultMessageId = messageId;
  writeAll(data);
  return poll;
}
