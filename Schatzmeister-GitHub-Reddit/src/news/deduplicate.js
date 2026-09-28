const CANDIDATE_MATCH_WINDOW_MS = 72 * 60 * 60 * 1000;
const SAME_TITLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_WORDS = new Set([
  "aion", "aion2", "news", "update", "updates", "patch", "patches", "notes", "official",
  "global", "korea", "korean", "taiwan", "server", "servers", "the", "and", "for", "with",
  "from", "this", "that", "into", "after", "before", "new", "latest"
]);

function words(value) {
  return new Set((String(value || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter(word => !GENERIC_WORDS.has(word)));
}

function similarityStats(left, right) {
  const leftWords = words(left);
  const rightWords = words(right);
  const overlap = [...leftWords].filter(word => rightWords.has(word)).length;
  return {
    overlap,
    jaccard: overlap / Math.max(1, new Set([...leftWords, ...rightWords]).size),
    containment: overlap / Math.max(1, Math.min(leftWords.size, rightWords.size))
  };
}

function withinWindow(left, right, windowMs) {
  const leftDate = Date.parse(left.publishedAt || "");
  const rightDate = Date.parse(right.publishedAt || "");
  return !Number.isFinite(leftDate) || !Number.isFinite(rightDate)
    || Math.abs(leftDate - rightDate) <= windowMs;
}

export function sameNewsStory(left, right) {
  if (left.region !== right.region || !withinWindow(left, right, SAME_TITLE_WINDOW_MS)) return false;
  const titleOverlap = similarityStats(left.title, right.title);
  if (titleOverlap.overlap >= 3 && (titleOverlap.jaccard >= 0.55 || titleOverlap.containment >= 0.75)) return true;
  if (!withinWindow(left, right, CANDIDATE_MATCH_WINDOW_MS)) return false;

  const combinedOverlap = similarityStats(
    `${left.title || ""} ${left.summary || left.description || ""}`,
    `${right.title || ""} ${right.summary || right.description || ""}`
  );
  return combinedOverlap.overlap >= 4
    && (combinedOverlap.jaccard >= 0.22 || combinedOverlap.containment >= 0.4);
}

export function groupNewsStories(items) {
  const groups = [];
  for (const item of items) {
    let group = groups.find(candidate => candidate.some(existing => sameNewsStory(existing, item)));
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(item);
  }
  return groups;
}
