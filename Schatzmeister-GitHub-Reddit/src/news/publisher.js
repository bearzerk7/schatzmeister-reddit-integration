import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { hasEnglishTranslation, isKoreanStory } from "./translation.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");

function isUnknownMessageError(error) {
  return Number(error?.code || error?.rawError?.code) === 10008;
}

const CONTENT_TYPES = {
  NEWS: { color: 0x438DCE },
  "PATCH NOTES": { color: 0x8B72C7 },
  "DATAMINE / LEAK": { color: 0xB88B51 }
};

function articleChunks(story) {
  if (hasEnglishTranslation(story)) {
    const translated = String(story.translatedFullText || story.translatedSummary || "").trim();
    return [translated || "Koreanischer Beitrag; der Originaltext ist über den Quellenlink erreichbar."];
  }
  if (isKoreanStory(story)) {
    const rawPreview = compactArticleText(story.summary || story.fullText || story.title, story)
      .replace(/\s+/g, " ")
      .trim();
    const excerpt = (rawPreview || story.title || "").slice(0, 220);
    const notice = getStoryContentType(story) === "DATAMINE / LEAK"
      ? "Möglicher Hinweis aus einer koreanischen Community-Quelle; nicht offiziell bestätigt."
      : "Koreanischer Originalbeitrag; keine Übersetzung verfügbar.";
    const excerptBlock = excerpt ? `\n\n**Kurzer Originalauszug · Koreanisch:**\n> ${excerpt}${rawPreview.length > 220 ? "…" : ""}` : "";
    return [`${notice}${excerptBlock}`];
  }
  const article = String(story.translatedFullText || story.fullText || story.translatedSummary || story.summary || "").trim();
  return [article || "\u200b"];
}

function displayTitle(story) {
  if (hasEnglishTranslation(story) && story.translatedTitle) return story.translatedTitle;
  if (!isKoreanStory(story)) return story.title || "AION 2 Update";
  const contentType = getStoryContentType(story);
  const typeLabel = contentType === "DATAMINE / LEAK" ? "Datamine-/Leak-Hinweis"
    : contentType === "PATCH NOTES" ? "Patch Notes" : "News-Hinweis";
  return `AION 2 · ${typeLabel} aus Korea`;
}

function getTypeStyle(story) {
  return CONTENT_TYPES[getStoryContentType(story)];
}

function getStoryContentType(story) {
  if (story.status === "DATAMINE" || story.status === "LEAK" || story.contentType === "DATAMINE / LEAK") {
    return "DATAMINE / LEAK";
  }
  return story.contentType === "PATCH NOTES" ? "PATCH NOTES" : "NEWS";
}

function compactArticleText(value, story) {
  const titleKeys = new Set([story.title, story.translatedTitle]
    .filter(Boolean)
    .map(title => String(title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim()));
  const breadcrumb = /Shugo\.GG\s*[›»]\s*AION\s*2\s*News\s*[›»]\s*(?:News|Patch Notes?)\s*·\s*AION\s*2\s*(?:Korea\s*\/\s*Taiwan|Global)\s*·\s*[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}/gi;
  return String(value || "")
    .replace(breadcrumb, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map(block => block.split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !(line.length < 240 && /\bshugo\.gg\b/i.test(line) && /[›»]/.test(line)))
      .filter(line => !titleKeys.has(line.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim()))
      .map(line => /^\p{Extended_Pictographic}/u.test(line) ? `**${line}**` : line)
      .join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

function createBanner(story) {
  const contentType = getStoryContentType(story);
  const typeName = contentType === "PATCH NOTES" ? "Patch-Notes"
    : contentType === "DATAMINE / LEAK" ? "Datamine-Leak" : "News";
  const regionName = contentType === "DATAMINE / LEAK"
    ? story.region === "KOREA" ? "Korea" : "Global"
    : story.region === "KOREA" ? "KR-TW" : "Global";
  const filename = `Banner-${typeName}-${regionName}.png`;
  return {
    attachment: new AttachmentBuilder(path.join(ASSETS_DIR, filename), { name: filename }),
    filename,
    embed: new EmbedBuilder().setColor(getTypeStyle(story).color).setImage(`attachment://${filename}`)
  };
}

export function buildNewsEmbed(story, body = null) {
  const contentType = getStoryContentType(story);
  const typeStyle = CONTENT_TYPES[contentType] || CONTENT_TYPES.NEWS;
  const regionLabel = contentType === "DATAMINE / LEAK"
    ? story.region === "KOREA" ? "KOREA" : "GLOBAL"
    : story.region === "KOREA" ? "KR / TAIWAN" : story.region === "GLOBAL" ? "GLOBAL" : story.region;
  const sourceLinks = (story.sources || []).slice(0, 8)
    .map(source => `• [${source.name}](${source.url})`)
    .join("\n");
  const embed = new EmbedBuilder()
    .setTitle(displayTitle(story).slice(0, 256))
    .setColor(typeStyle.color)
    .addFields({ name: `<t:${Math.floor(new Date(story.publishedAt || Date.now()).getTime() / 1000)}:D>`, value: "Veröffentlicht", inline: false });
  const articleText = compactArticleText(body ?? (story.translatedFullText || story.fullText || story.translatedSummary || story.summary || ""), story);
  const categoryQuote = `> **${regionLabel} • ${contentType}**`;
  const descriptionPrefix = `${categoryQuote}\n`;
  const moreLink = story.sources?.[0]?.url ? `\n… **Mehr lesen:** [Originalbeitrag öffnen](${story.sources[0].url})` : "\n… (gekürzt; Originalquelle ist verlinkt)";
  const maxArticleLength = 4096 - descriptionPrefix.length;
  const untranslatedKorean = isKoreanStory(story) && !hasEnglishTranslation(story);
  const description = untranslatedKorean
    ? `${descriptionPrefix}${articleText}${moreLink}`
    : articleText.length > maxArticleLength
      ? `${descriptionPrefix}${articleText.slice(0, maxArticleLength - moreLink.length).trimEnd()}${moreLink}`
      : `${descriptionPrefix}${articleText}`;
  embed.setDescription(description || "\u200b");
  if (hasEnglishTranslation(story)) embed.setFooter({ text: "Koreanisch → Englisch übersetzt · Originalquelle unten verlinkt" });
  if (sourceLinks) embed.addFields({ name: story.sources.length > 1 ? "Quellen" : "Quelle", value: sourceLinks.slice(0, 1024), inline: false });
  if (story.sources?.[0]?.url) embed.setURL(story.sources[0].url);
  return embed;
}

export async function publishStory(client, channelId, story) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error("Der konfigurierte News-Kanal ist kein Textkanal.");
  const chunks = articleChunks(story);
  const banner = createBanner(story);
  const message = await channel.send({ embeds: [banner.embed, buildNewsEmbed(story, chunks[0])], files: [banner.attachment], allowedMentions: { parse: [] } });
  return { discordMessageId: message.id, continuationMessageIds: [] };
}

export async function updateStoryMessage(client, channelId, story) {
  if (!story.discordMessageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(story.discordMessageId).catch(() => null);
  if (!message) return false;
  const chunks = articleChunks(story);
  const banner = createBanner(story);
  try {
    await message.edit({ embeds: [banner.embed, buildNewsEmbed(story, chunks[0])], files: [banner.attachment], attachments: [], allowedMentions: { parse: [] } });
  } catch (error) {
    if (isUnknownMessageError(error)) return false;
    throw error;
  }
  const continuationMessageIds = [];
  for (const staleId of story.continuationMessageIds || []) {
    const stale = await channel.messages.fetch(staleId).catch(() => null);
    if (stale) await stale.delete().catch(() => {});
  }
  return { discordMessageId: message.id, continuationMessageIds };
}

