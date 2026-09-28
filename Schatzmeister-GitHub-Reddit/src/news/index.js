import { classifyCandidate, isIndependentRumorGroup } from "./classify.js";
import { groupNewsStories, sameNewsStory } from "./deduplicate.js";
import { fetchAllSources } from "./sources.js";
import { readNewsState, rememberCandidate, writeNewsState } from "./storage.js";
import { publishStory, updateStoryMessage } from "./publisher.js";
import { hasEnglishTranslation, isKoreanStory, translateStoryToEnglish } from "./translation.js";

const STATUS_RANK = { COMMUNITY: 1, GERÜCHT: 2, DATAMINE: 3, LEAK: 4, OFFIZIELL: 5 };
const BOOTSTRAP_WINDOW_MS = 6 * 60 * 60 * 1000;
const NEWS_CARD_VERSION = 9;
const unavailableSources = new Map();

const GERMAN_SIGNAL_WORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "und", "für", "mit", "von", "auf", "ist", "sind", "wird", "werden",
  "bei", "nach", "vor", "über", "auch", "nicht", "können", "hat", "haben", "zum", "zur", "im", "ins", "eine", "einer", "eines", "einem"
]);

function isGermanText(value) {
  const text = String(value || "");
  if (!text || /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(text)) return false;
  if (/[äöüß]/iu.test(text)) return true;
  const words = text.toLocaleLowerCase().match(/[\p{L}]+/gu) || [];
  if (words.length < 12) return false;
  const signals = words.filter(word => GERMAN_SIGNAL_WORDS.has(word)).length;
  return signals >= 3 && signals / words.length >= 0.045;
}

function sourceTextScore(item, value, mode) {
  const text = String(value || "").trim();
  if (!text) return Number.NEGATIVE_INFINITY;
  let score = isGermanText(text) ? 1000 : 0;
  if (item.sourceKind === "official") score += 120;
  if (/\bshugo\.gg\b[^\n]{0,100}[›»]/i.test(text)) score -= 180;
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean).length;
  if (mode === "summary") {
    const targetLength = 320;
    score += Math.max(-100, 100 - Math.abs(text.length - targetLength) / 3);
    const sentences = text.split(/(?<=[.!?。])\s+/).filter(Boolean).length;
    if (sentences >= 2 && sentences <= 5) score += 35;
    if (sentences > 8) score -= 60;
  } else {
    score += Math.min(paragraphs, 10) * 12;
    score += Math.min(text.length, 5000) / 200;
    if (text.length < 120) score -= 90;
  }
  return score;
}

function bestSourceItem(items, textSelector, mode) {
  return [...items].sort((left, right) =>
    sourceTextScore(right, textSelector(right), mode) - sourceTextScore(left, textSelector(left), mode)
  )[0];
}

async function addEnglishTranslation(story, config) {
  if (!config.newsTranslationEnabled || !isKoreanStory(story) || hasEnglishTranslation(story)) return;
  try {
    Object.assign(story, await translateStoryToEnglish(story, config));
  } catch (error) {
    console.warn(`Koreanisch-Englisch-Übersetzung fehlgeschlagen (${story.title}): ${error.message}`);
  }
}

async function refreshRecentNewsCards(client, config, state, force = false) {
  if (!force && (state.presentationVersion || 0) >= NEWS_CARD_VERSION) return 0;
  const recentStories = state.stories.filter(story => story.discordMessageId).slice(-5);
  let refreshed = 0;
  for (const story of recentStories) {
    try {
      await addEnglishTranslation(story, config);
      const updated = await updateStoryMessage(client, config.newsChannelId, story);
      if (updated) {
        Object.assign(story, updated);
        refreshed++;
      } else {
        story.discordMessageId = null;
        story.continuationMessageIds = [];
        refreshed++;
      }
    } catch (error) {
      if (Number(error?.code || error?.rawError?.code) === 10008) {
        story.discordMessageId = null;
        story.continuationMessageIds = [];
        refreshed++;
      } else {
        console.warn(`News-Karte konnte nicht aktualisiert werden (${story.title}): ${error.message}`);
      }
    }
  }
  if (refreshed === recentStories.length) state.presentationVersion = NEWS_CARD_VERSION;
  writeNewsState(state);
  return refreshed;
}

export async function refreshLatestNewsCards(client, config) {
  const state = readNewsState();
  const fetched = await fetchAllSources(new Set(), config);
  const pending = state.stories.length
    ? fetched.items.filter(item => !state.seenIds.includes(item.id))
    : fetched.items
      .filter(item => item.publishedAt && Date.parse(item.publishedAt) >= Date.now() - BOOTSTRAP_WINDOW_MS)
      .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
      .slice(-8);
  if (pending.length) await processItems(client, config, state, pending);

  const byDate = (left, right) => {
    const leftDate = Date.parse(left.publishedAt || "");
    const rightDate = Date.parse(right.publishedAt || "");
    return (Number.isFinite(leftDate) ? leftDate : 0) - (Number.isFinite(rightDate) ? rightDate : 0);
  };
  const recentStories = [...state.stories].sort(byDate).slice(-5);
  if (!recentStories.length) return { updated: 0, recreated: 0, total: 0, sourceResults: fetched.sourceResults, skippedSources: fetched.skippedSources };
  for (const story of recentStories) await addEnglishTranslation(story, config);

  const channel = await client.channels.fetch(config.newsChannelId);
  if (!channel?.isTextBased()) throw new Error("Der konfigurierte News-Kanal ist kein Textkanal.");
  const existing = await Promise.all(recentStories.map(async story => story.discordMessageId
    ? channel.messages.fetch(story.discordMessageId).catch(() => null)
    : null));
  const allExist = existing.every(Boolean);
  const storedOrderIsChronological = recentStories.every((story, index) => {
    if (index === 0) return /^\d+$/.test(String(story.discordMessageId || ""));
    const previousId = String(recentStories[index - 1].discordMessageId || "");
    const currentId = String(story.discordMessageId || "");
    return /^\d+$/.test(previousId) && /^\d+$/.test(currentId) && BigInt(previousId) < BigInt(currentId);
  });

  if (allExist && storedOrderIsChronological) {
    let updated = 0;
    let missingCard = false;
    for (const story of recentStories) {
      const result = await updateStoryMessage(client, config.newsChannelId, story);
      if (result) {
        Object.assign(story, result);
        updated++;
      } else {
        story.discordMessageId = null;
        story.continuationMessageIds = [];
        missingCard = true;
      }
    }
    if (!missingCard) {
      state.presentationVersion = NEWS_CARD_VERSION;
      writeNewsState(state);
      return { updated, recreated: 0, total: recentStories.length, sourceResults: fetched.sourceResults, skippedSources: fetched.skippedSources };
    }
  }

  for (let index = 0; index < recentStories.length; index++) {
    if (existing[index]) await existing[index].delete().catch(error => {
      if (Number(error?.code || error?.rawError?.code) !== 10008) {
        console.warn(`News-Karte konnte vor dem Neuaufbau nicht gelöscht werden (${recentStories[index].title}): ${error.message}`);
      }
    });
    for (const continuationId of recentStories[index].continuationMessageIds || []) {
      const continuation = await channel.messages.fetch(continuationId).catch(() => null);
      if (continuation) await continuation.delete().catch(() => {});
    }
    recentStories[index].discordMessageId = null;
    recentStories[index].continuationMessageIds = [];
  }
  writeNewsState(state);

  let recreated = 0;
  for (const story of recentStories) {
    Object.assign(story, await publishStory(client, config.newsChannelId, story));
    recreated++;
    writeNewsState(state);
  }
  state.presentationVersion = NEWS_CARD_VERSION;
  writeNewsState(state);
  return { updated: 0, recreated, total: recentStories.length, sourceResults: fetched.sourceResults, skippedSources: fetched.skippedSources };
}

function mergeSources(items, existing = []) {
  const sources = [...existing];
  const seenUrls = new Set(sources.map(source => source.url));
  for (const item of items) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      sources.push({ name: item.sourceName || "Quelle", url: item.url, author: item.author || null });
    }
    if (item.externalUrl && !seenUrls.has(item.externalUrl)) {
      seenUrls.add(item.externalUrl);
      sources.push({ name: "Verlinkte Quelle", url: item.externalUrl, author: null });
    }
  }
  return sources;
}

function makeStory(items, previous = null) {
  const strongest = [...items].sort((a, b) => (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0));
  const primary = strongest[0];
  const bestTitle = bestSourceItem(items, item => `${item.title || ""}\n${item.summary || ""}\n${item.fullText || ""}`, "summary");
  const bestSummary = bestSourceItem(items, item => item.summary || item.description || "", "summary");
  const bestArticle = bestSourceItem(items, item => item.fullText || item.summary || item.description || "", "article");
  const publishedTimes = items.map(item => Date.parse(item.publishedAt)).filter(Number.isFinite);
  const status = (STATUS_RANK[primary.status] || 0) >= (STATUS_RANK[previous?.status] || 0)
    ? primary.status
    : previous.status;
  const title = bestTitle?.title || primary.title || previous?.title || "AION 2 update";
  const summary = bestSummary?.summary || bestSummary?.description || previous?.summary || "";
  const fullText = bestArticle?.fullText || bestArticle?.summary || bestArticle?.description || previous?.fullText || summary;
  return {
    id: previous?.id || `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    summary,
    fullText,
    region: primary.region || previous?.region || "GLOBAL",
    contentType: items.some(item => item.contentType === "PATCH NOTES") ? "PATCH NOTES"
      : primary.contentType || previous?.contentType || "NEWS",
    translatedTitle: previous?.title === title ? previous.translatedTitle : null,
    translatedSummary: previous?.summary === summary ? previous.translatedSummary : null,
    translatedFullText: previous?.fullText === fullText ? previous.translatedFullText : null,
    translatedLanguage: previous?.title === title && previous?.summary === summary && previous?.fullText === fullText
      ? previous.translatedLanguage || null
      : null,
    status,
    publishedAt: previous?.publishedAt || (publishedTimes.length ? new Date(Math.min(...publishedTimes)).toISOString() : new Date().toISOString()),
    sources: mergeSources(items, previous?.sources || []),
    discordMessageId: previous?.discordMessageId || null,
    continuationMessageIds: previous?.continuationMessageIds || []
  };
}

async function processItems(client, config, state, candidates) {
  const classified = candidates.map(classifyCandidate).filter(Boolean);
  const failedIds = new Set();
  const allRumors = [...state.pendingRumors, ...classified.filter(item => item.status === "GERÜCHT")];
  const rumorGroups = groupNewsStories(allRumors);
  const readyRumorGroups = rumorGroups.filter(group => isIndependentRumorGroup(group));
  state.pendingRumors = rumorGroups.filter(group => !isIndependentRumorGroup(group)).flat().slice(-100);

  const publishable = [
    ...classified.filter(item => item.status !== "GERÜCHT"),
    ...readyRumorGroups.flat()
  ];
  const groups = groupNewsStories(publishable).sort((left, right) => {
    const leftDate = Date.parse(left[0]?.publishedAt || "");
    const rightDate = Date.parse(right[0]?.publishedAt || "");
    return (Number.isFinite(leftDate) ? leftDate : 0) - (Number.isFinite(rightDate) ? rightDate : 0);
  });

  for (const group of groups) {
    const anchor = group[0];
    const previous = state.stories.find(story => sameNewsStory(story, anchor));
    if (previous) {
      const changedSourceCount = previous.sources.length;
      const updated = makeStory(group, previous);
      await addEnglishTranslation(updated, config);
      if (updated.sources.length !== changedSourceCount || updated.status !== previous.status || updated.contentType !== previous.contentType || updated.title !== previous.title || updated.summary !== previous.summary || updated.fullText !== previous.fullText || updated.translatedTitle !== previous.translatedTitle || updated.translatedSummary !== previous.translatedSummary || updated.translatedFullText !== previous.translatedFullText) {
        try {
          const edited = await updateStoryMessage(client, config.newsChannelId, updated);
          if (edited) Object.assign(updated, edited);
          else Object.assign(updated, await publishStory(client, config.newsChannelId, updated));
          console.log(`Newsfeed: Meldung ergänzt (${updated.title}).`);
        } catch (error) {
          console.error("Newsfeed: vorhandener Beitrag konnte nicht ergänzt werden:", error.message);
          for (const item of group) failedIds.add(item.id);
          continue;
        }
        Object.assign(previous, updated);
      }
      for (const item of group) rememberCandidate(state, item);
      writeNewsState(state);
      continue;
    }

    const story = makeStory(group);
    try {
      await addEnglishTranslation(story, config);
      Object.assign(story, await publishStory(client, config.newsChannelId, story));
      state.stories.push(story);
      state.stories = state.stories.slice(-500);
      for (const item of group) rememberCandidate(state, item);
      writeNewsState(state);
      console.log(`Newsfeed: ${story.region} · ${story.status}: ${story.title}`);
    } catch (error) {
      console.error("Newsfeed: Veröffentlichung fehlgeschlagen; die Meldung wird später erneut versucht:", error.message);
      for (const item of group) failedIds.add(item.id);
    }
  }

  for (const item of candidates) {
    if (!failedIds.has(item.id)) rememberCandidate(state, item);
  }
  writeNewsState(state);
}

async function checkNews(client, config) {
  const state = readNewsState();
  await refreshRecentNewsCards(client, config, state);
  const { items, errors, availableSources, skippedSources } = await fetchAllSources(new Set(state.seenIds), config);
  for (const error of errors) {
    const previousMessage = unavailableSources.get(error.source);
    if (previousMessage !== error.message) {
      console.log(`Newsfeed-Quelle vorübergehend nicht erreichbar (${error.source}): ${error.message}`);
      unavailableSources.set(error.source, error.message);
    }
  }
  for (const source of availableSources) {
    if (unavailableSources.has(source)) {
      console.log(`Newsfeed-Quelle wieder erreichbar (${source}).`);
      unavailableSources.delete(source);
    }
  }
  if (!items.length) return;

  const isFirstCheck = !state.initialized;
  let candidates = items.filter(item => !state.seenIds.includes(item.id));
  if (isFirstCheck) {
    state.initialized = true;
    const cutoff = Date.now() - BOOTSTRAP_WINDOW_MS;
    const recentIds = new Set(candidates
      .filter(item => item.publishedAt && Date.parse(item.publishedAt) >= cutoff)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 8)
      .map(item => item.id));
    for (const item of candidates) {
      if (!recentIds.has(item.id)) rememberCandidate(state, item);
    }
    candidates = candidates.filter(item => recentIds.has(item.id));
    writeNewsState(state);
  }
  if (candidates.length) await processItems(client, config, state, candidates);
}

export async function startNewsFeed(client, config) {
  if (!config.newsChannelId) {
    console.warn("Newsfeed ist eingeschaltet, aber NEWS_CHANNEL_ID fehlt. Automatische Veröffentlichung wartet auf die Kanal-ID.");
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await checkNews(client, config);
    } catch (error) {
      console.error("Newsfeed-Zyklus fehlgeschlagen; DKP und Polls laufen weiter:", error);
    } finally {
      running = false;
    }
  };
  console.log(`Automatischer AION 2-Newsfeed aktiv; Quellenprüfung alle ${config.newsPollIntervalMinutes} Minuten.`);
  await run();
  setInterval(() => void run(), config.newsPollIntervalMinutes * 60 * 1000);
}



