import { cleanMarkup } from "./sources.js";

const DATAMINE_PATTERN = /\bdatamin(?:e|ed|ing)\b|데이터\s*마이닝|클뜯/i;
const LEAK_PATTERN = /\b(leak(?:ed|s)?|unreleased|internal build|test client)\b|유출/i;
const RUMOR_PATTERN = /\b(rumou?r|unconfirmed|allegedly|speculation|rumou?red)\b|\bgerücht(?:e|en)?\b|unbestätigt|spekulation|루머|소문|미확인/i;
const OFF_TOPIC_PATTERN = /\b(meme|memes|recruit(?:ment)?|looking for (?:a )?guild|guild recruitment|giveaway|fan art|cosplay|off.?topic)\b|밈|모집/i;
const NEGATIVE_PATTERN = /\b(dead game|trash|garbage|scam|worst game|hate nc|ncsoft is|rage|doomer|cash grab)\b|망겜|쓰레기|최악/i;
const OPINION_PATTERN = /\b(sucks?|awful|terrible|horrible|stupid|greedy|disgusting|unplayable|p2w trash)\b|개같|별로|최악|쓰레기/i;
const REPORT_PATTERN = /\b(bug|issue|error|problem|crash(?:es|ed)?|disconnect(?:s|ed)?|exploit|missing|unavailable|fails?|report(?:s|ed)?|investigat(?:e|ing)|reproducible|hotfix|fix(?:es|ed)?)\b|오류|버그|문제|충돌|접속|오작동|수정/i;
const FACT_PATTERN = /\b(update|patch|maintenance|bug|issue|skill|class|balance|server|event|feature|release|system|fix|dungeon|roadmap|notice|news|change|weapon|quest|item|leak|datamin|rumou?r|announcement)\b|업데이트|패치|점검|오류|버그|스킬|직업|밸런스|서버|이벤트|던전|공지/i;
const INFO_PATTERN = /\b(update|patch|maintenance|bug|issue|skill|class|balance|server|event|feature|release|system|fix|dungeon|roadmap|notice|news|change|weapon|quest|item|leak|datamin|rumou?r|rumou?red|unconfirmed|official|developer|announcement|launch|test|region|economy|trade|market|monetization|schedule|hotfix|nerf|buff)\b|gerüch(t|te|ten)?|unbestätigt|spekulation|leak|유출|클뜯|데이터\s*마이닝|루머|미확인|업데이트|패치|점검|오류|버그|스킬|직업|밸런스|서버|이벤트|던전|공지|경제|거래|테스트|출시/i;
const KR_PATTERN = /\b(korea|korean|kr server|korean server|south korea)\b|한국|대한민국|한국서버|국내서버/i;
const GLOBAL_PATTERN = /\b(global|global server|na server|eu server|north america|europe|western release)\b|글로벌|글섭|북미|유럽/i;

function inferContentType(candidate, text) {
  if (candidate.contentType) return candidate.contentType;
  const title = `${candidate.title || ""} ${candidate.description || ""}`;
  if (/patch\s*notes?|update\s*notes?|패치\s*노트|업데이트\s*노트/i.test(title)) return "PATCH NOTES";
  if (/maintenance|hot\s*fix|hotfix|점검|긴급\s*점검|핫픽스/i.test(title)) return "MAINTENANCE";
  if (/event|festival|attendance|이벤트|축제/i.test(title)) return "EVENT";
  if (/promotion|founder'?s pack|membership|coupon|프로모션|쿠폰/i.test(title)) return "PROMOTION";
  if (DATAMINE_PATTERN.test(text) || LEAK_PATTERN.test(text)) return "DATAMINE / LEAK";
  if (RUMOR_PATTERN.test(text)) return "RUMOR";
  if (/news|notice|announcement|공지|소식/i.test(title) || candidate.sourceKind === "official") return "NEWS";
  return "NEWS";
}

export function normalizeTitle(value = "") {
  return cleanMarkup(value)
    .replace(/^\s*\[[^\]]{1,24}\]\s*/, "")
    .replace(/^(?:aion\s*2|aion2)\s*[:|–—-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function classifyCandidate(candidate) {
  const title = normalizeTitle(candidate.title);
  const description = cleanMarkup(candidate.description || "").slice(0, 1400);
  const text = `${title} ${description} ${candidate.contentType || ""}`;
  if (!title || title.length < 8 || OFF_TOPIC_PATTERN.test(text)) return null;
  if ((NEGATIVE_PATTERN.test(text) || OPINION_PATTERN.test(text)) && !REPORT_PATTERN.test(text)) return null;
  if (candidate.sourceKind !== "official" && !INFO_PATTERN.test(text)) return null;

  const region = candidate.pinnedRegion
    ? candidate.regionHint
    : KR_PATTERN.test(text)
      ? "KOREA"
      : GLOBAL_PATTERN.test(text)
        ? "GLOBAL"
        : candidate.regionHint || "GLOBAL";
  const status = candidate.sourceKind === "official"
    ? "OFFIZIELL"
    : DATAMINE_PATTERN.test(text)
      ? "DATAMINE"
    : LEAK_PATTERN.test(text)
      ? "LEAK"
      : RUMOR_PATTERN.test(text)
        ? "GERÜCHT"
        : "COMMUNITY";

  const cleanDescription = description
    .replace(title, "")
    .replace(/^\s*[-:|—–.]+\s*/, "")
    .trim();
  const sentences = cleanDescription.split(/(?<=[.!?。])\s+/).filter(Boolean);
  const summary = (sentences.slice(0, 2).join(" ") || (description && description !== title ? description : ""))
    .slice(0, 850);

  return {
    ...candidate,
    title,
    description: cleanDescription,
    summary,
    region,
    contentType: inferContentType(candidate, text),
    status,
    normalizedWords: title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []
  };
}

export function titleSimilarity(left, right) {
  const a = new Set(left.normalizedWords || normalizeTitle(left.title).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  const b = new Set(right.normalizedWords || normalizeTitle(right.title).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(word => b.has(word)).length;
  return overlap / new Set([...a, ...b]).size;
}

export function isIndependentRumorGroup(items) {
  const traceableExternalLink = items.some(item => {
    try {
      const sourceHost = new URL(item.url).hostname;
      const external = new URL(item.externalUrl);
      return external.protocol === "https:" && external.hostname !== sourceHost;
    } catch { return false; }
  });
  if (traceableExternalLink) return true;
  const authors = new Set(items.map(item => {
    try { return item.author && `${new URL(item.url).hostname}:${item.author}`; }
    catch { return null; }
  }).filter(Boolean));
  return authors.size >= 2;
}
