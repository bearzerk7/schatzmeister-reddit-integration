import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const DATA_FILE = path.join(DATA_DIR, "news.json");

function emptyState() {
  return { initialized: false, seenIds: [], pendingRumors: [], stories: [] };
}

export function readNewsState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
  } catch {
    const corruptBackup = `${DATA_FILE}.${Date.now()}.corrupt`;
    fs.copyFileSync(DATA_FILE, corruptBackup);
    return emptyState();
  }
}

export function writeNewsState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporary, DATA_FILE);
}

export function rememberCandidate(state, item) {
  if (!state.seenIds.includes(item.id)) state.seenIds.push(item.id);
  state.seenIds = state.seenIds.slice(-3000);
}
