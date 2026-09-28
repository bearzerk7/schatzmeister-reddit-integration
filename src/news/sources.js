const HEADERS = {
  "user-agent": "Schatzmeister-AION2-Newsfeed/1.0 (automatic Discord news monitor)",
  accept: "text/html,application/json,application/atom+xml,application/rss+xml"
};

const SOURCE_LIST = [
  { key: "korea", name: "AION 2 Korea Notices", url: "https://aion2.plaync.com/ko-kr/board/notice/list", kind: "official", region: "KOREA", pinnedRegion: true },
  { key: "global", name: "AION 2 Global Notices", url: "https://aion2.plaync.com/en-us/board/notice/list", kind: "official", region: "GLOBAL", pinnedRegion: true },
  { key: "ncsoft", name: "NCSOFT AION 2 Newsroom", url: "https://about.ncsoft.com/en/news/all", kind: "official", region: "GLOBAL" },
  { key: "steam", name: "AION 2 Steam News", type: "steam", appId: 3393110, kind: "official", region: "GLOBAL" },
  { key: "shugo", name: "Shugo.GG · AION 2 News & Patch Notes", type: "rss", url: "https://shugo.gg/feed.xml", kind: "community" },
  { key: "inven", name: "AION 2 Inven · Datamine/Leak-Hinweise", type: "forum", url: "https://www.inven.co.kr/board/aion2/6388", forum: "inven", kind: "community", region: "KOREA" },
  { key: "dcinside", name: "AION 2 DCInside · Datamine/Leak-Hinweise", type: "forum", url: "https://gall.dcinside.com/mgallery/board/lists/?id=aion2", forum: "dcinside", kind: "community", region: "KOREA" }
];

const DATAMINE_HINT = /\bdatamin(?:e|ed|ing)\b|데이터\s*마이닝|클뜯/i;
const LEAK_HINT = /\bleak(?:ed|s)?\b|유출|유출됨/i;
const SHUGO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function decodeHtml(value = "") {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)));
}

export function cleanMarkup(value = "") {
  return decodeHtml(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")).trim();
}

function extractArticleText(html) {
  const match = html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  if (!match) return "";
  const body = match[1]
    .replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|section|li|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");
  return decodeHtml(body.replace(/<[^>]+>/g, " "))
    .split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
}

async function getText(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function parseBoard(html, source) {
  const results = [];
  const officialArticlePattern = source.url.includes("about.ncsoft.com")
    ? /\/en\/news\/article\/aion2[^"'\s<>]*/i
    : /\/board\/notice\/view[^"'\s<>]*/i;
  const anchorPattern = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2].replace(/\\\//g, "/"));
    if (!officialArticlePattern.test(href)) continue;
    const url = new URL(href, source.url).href;
    const title = cleanMarkup(match[3]);
    if (!title || title.length < 4 || results.some(item => item.url === url)) continue;
    const before = html.slice(Math.max(0, match.index - 350), match.index);
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 350);
    const dateMatch = `${before} ${after}`.match(/20\d{2}[./-]\s?\d{1,2}[./-]\s?\d{1,2}(?:\s+\d{1,2}:\d{2})?/);
    const timestamp = dateMatch ? Date.parse(dateMatch[0].replace(/\.\s*/g, "-")) : NaN;
    const publishedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
    results.push({
      id: url,
      url,
      title,
      description: "",
      publishedAt,
      author: source.name,
      sourceName: source.name,
      sourceKind: "official",
      regionHint: source.region,
      pinnedRegion: source.pinnedRegion
    });
  }
  return results.slice(0, 25);
}

async function fetchOfficial(source, knownIds) {
  const html = await getText(source.url);
  const results = parseBoard(html, source);
  return await Promise.all(results.filter(item => !knownIds.has(item.id)).slice(0, 6).map(async item => {
    try {
      const article = await getText(item.url);
      item.fullText = extractArticleText(article);
      const description = article.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1]
        || article.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1];
      if (description) item.description = cleanMarkup(description);
    } catch {}
    return item;
  }));
}

async function fetchSteamNews(source) {
  const endpoint = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  endpoint.searchParams.set("appid", String(source.appId));
  endpoint.searchParams.set("count", "20");
  endpoint.searchParams.set("maxlength", "0");
  endpoint.searchParams.set("format", "json");
  const response = await fetch(endpoint, {
    headers: { ...HEADERS, accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const parsed = await response.json();
  return (parsed.appnews?.newsitems || []).map(item => ({
    id: `steam:${item.gid}`,
    url: item.url,
    title: cleanMarkup(item.title || ""),
    description: cleanMarkup(item.contents || "").slice(0, 1400),
    fullText: cleanMarkup(item.contents || ""),
    publishedAt: item.date ? new Date(Number(item.date) * 1000).toISOString() : null,
    author: item.author || source.name,
    sourceName: source.name,
    sourceKind: "official",
    regionHint: source.region,
    pinnedRegion: true
  })).filter(item => item.title && item.url);
}

function readXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim() || "";
}

async function fetchShugoNews(source, knownIds) {
  const xml = await getText(source.url);
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map(match => match[1]);
  const stories = items.slice(0, 40).map(item => {
    const title = cleanMarkup(readXmlTag(item, "title"));
    const url = decodeHtml(readXmlTag(item, "link"));
    const fullText = cleanMarkup(
      readXmlTag(item, "description") || readXmlTag(item, "content:encoded") || readXmlTag(item, "summary")
    );
    const description = fullText.slice(0, 1400);
    const categoryText = [...item.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category\s*>/gi)]
      .map(match => cleanMarkup(match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")))
      .join(" ");
    const contentType = /patch\s*notes?/i.test(categoryText) ? "PATCH NOTES"
      : /maintenance/i.test(categoryText) ? "MAINTENANCE"
        : /event/i.test(categoryText) ? "EVENT"
          : /promotion/i.test(categoryText) ? "PROMOTION"
            : /news/i.test(categoryText) ? "NEWS" : null;
    const location = `${categoryText} ${title}`;
    const regionHint = /\bglobal\b|\bna\b|\beu\b/i.test(location)
      ? "GLOBAL"
      : /\bkorea\b|\bkorean\b|\bkr\b|\btaiwan\b|\btw\b/i.test(location)
        ? "KOREA"
        : null;
    const published = Date.parse(readXmlTag(item, "pubDate"));
    return {
      id: `shugo:${url}`,
      url,
      title,
      description,
      fullText,
      publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
      author: "Shugo.GG",
      sourceName: source.name,
      sourceKind: "community",
      contentType,
      regionHint,
      pinnedRegion: Boolean(regionHint)
    };
  }).filter(item => {
    if (!item.title || !item.url.startsWith("https://shugo.gg/news/")) return false;
    if (!item.publishedAt) return true;
    const age = Date.now() - Date.parse(item.publishedAt);
    return age >= 0 && age <= SHUGO_MAX_AGE_MS;
  }).slice(0, 10);
  return await Promise.all(stories.map(async item => {
    if (knownIds.has(item.id)) return item;
    try {
      const articlePage = await getText(item.url);
      const articleText = extractArticleText(articlePage);
      if (articleText.length > item.fullText.length) item.fullText = articleText;
      if (articleText) item.description = articleText.slice(0, 1400);
    } catch {}
    return item;
  }));
}

function parseForumDate(row) {
  const now = new Date();
  const seoul = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  let [, year, month, day, hour, minute] = row.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})[^\d]{0,8}(\d{1,2}):(\d{2})/)
    || [];
  if (year) {
    const timestamp = Date.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00+09:00`);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  const monthDay = row.match(/(?:^|\s)(\d{1,2})-(\d{1,2})(?:\s|$)/);
  const [, currentYear, currentMonth, currentDay] = seoul.match(/(\d{4})-(\d{2})-(\d{2})/) || [];
  if (monthDay) {
    const timeOnly = row.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    year = currentYear; month = monthDay[1]; day = monthDay[2];
    hour = timeOnly?.[1] || "12"; minute = timeOnly?.[2] || "00";
    if (Number(month) > Number(currentMonth) + 1) year = String(Number(year) - 1);
  } else {
    const timeOnly = row.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    if (!timeOnly) return null;
    year = currentYear; month = currentMonth; day = currentDay;
    hour = timeOnly[1]; minute = timeOnly[2];
  }
  const timestamp = Date.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00+09:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isDatamineOrLeak(text) {
  return DATAMINE_HINT.test(text) || LEAK_HINT.test(text);
}

function parseForum(html, source) {
  const results = [];
  const linkPattern = source.forum === "inven"
    ? /<a\b[^>]*href=["']([^"']*\/board\/aion2\/6388\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
    : /<a\b[^>]*href=["']([^"']*\/board\/view\/\?[^"']*\bid=aion2[^"']*\bno=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const href = decodeHtml(match[1].replace(/&amp;/g, "&"));
    const title = cleanMarkup(match[2]);
    if (!title || !isDatamineOrLeak(title)) continue;
    const start = html.lastIndexOf("<tr", match.index);
    const end = html.indexOf("</tr>", match.index);
    const row = start >= 0 && end > start ? html.slice(start, end + 5) : match[0];
    const url = new URL(href, source.url).href;
    if (results.some(item => item.url === url)) continue;
    results.push({
      id: `${source.forum}:${url}`,
      url,
      title,
      description: cleanMarkup(row).slice(0, 700),
      publishedAt: parseForumDate(cleanMarkup(row)),
      author: null,
      sourceName: source.name,
      sourceKind: "community",
      regionHint: "KOREA",
      pinnedRegion: true
    });
  }
  return results.slice(0, 20);
}

async function fetchForum(source, knownIds) {
  const html = await getText(source.url);
  const matches = parseForum(html, source).filter(item => !knownIds.has(item.id)).slice(0, 6);
  return await Promise.all(matches.map(async item => {
    try {
      const article = await getText(item.url);
      item.fullText = extractArticleText(article);
      const description = article.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1]
        || article.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1];
      if (description) item.description = cleanMarkup(description).slice(0, 1400);
    } catch {}
    return item;
  }));
}

export async function fetchAllSources(knownIds = new Set(), config = {}) {
  const sourceSettings = config.newsSources || {};
  const skippedSources = [];
  for (const source of SOURCE_LIST) {
    if (sourceSettings[source.key] === false) {
      skippedSources.push({ source: source.name, reason: "in der Bot-Konfiguration deaktiviert." });
    }
  }
  const tasks = [
    ...SOURCE_LIST.filter(source => sourceSettings[source.key] !== false).map(source => ({
      name: source.name,
      run: () => source.type === "steam"
        ? fetchSteamNews(source)
        : source.type === "rss"
          ? fetchShugoNews(source, knownIds)
        : source.type === "forum"
          ? fetchForum(source, knownIds)
          : fetchOfficial(source, knownIds)
    })),
  ];
  const settled = await Promise.allSettled(tasks.map(task => task.run()));
  const items = [];
  const errors = [];
  const availableSources = [];
  const sourceResults = [];
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    const name = tasks[index].name;
    if (result.status === "fulfilled") {
      items.push(...result.value);
      availableSources.push(name);
      const datedItems = [...result.value].sort((left, right) => {
        const leftDate = Date.parse(left.publishedAt || "");
        const rightDate = Date.parse(right.publishedAt || "");
        return (Number.isFinite(leftDate) ? leftDate : 0) - (Number.isFinite(rightDate) ? rightDate : 0);
      });
      sourceResults.push({ name, ok: true, count: result.value.length, titles: datedItems.slice(-2).map(item => item.title) });
    } else {
      const message = result.reason?.message || String(result.reason);
      errors.push({ source: name, message });
      sourceResults.push({ name, ok: false, count: 0, error: message });
    }
  }
  return { items, errors, availableSources, skippedSources, sourceResults };
}
