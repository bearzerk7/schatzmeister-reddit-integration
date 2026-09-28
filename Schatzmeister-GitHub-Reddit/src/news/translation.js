function splitText(text, limit = 1800) {
  const chunks = [];
  for (const paragraph of String(text || "").split(/\n{2,}/)) {
    let rest = paragraph;
    while (rest.length > limit) {
      let splitAt = rest.lastIndexOf(" ", limit);
      if (splitAt < Math.floor(limit / 2)) splitAt = limit;
      chunks.push(rest.slice(0, splitAt));
      rest = rest.slice(splitAt).trimStart();
    }
    if (rest) chunks.push(rest);
  }
  return chunks.length ? chunks : [""];
}

export function containsKoreanText(value) {
  const text = String(value || "");
  const letters = [...text].filter(character => /\p{L}/u.test(character));
  const korean = letters.filter(character => /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(character));
  return korean.length >= 3 && korean.length / Math.max(letters.length, 1) >= 0.12;
}

export function isKoreanStory(story) {
  return [story.title, story.summary, story.fullText].some(containsKoreanText);
}

export function hasEnglishTranslation(story) {
  return story.translatedLanguage === "en"
    && Boolean(story.translatedFullText || story.translatedSummary);
}

export async function translateStoryToEnglish(story, config) {
  const endpoint = config.libreTranslateUrl || "http://127.0.0.1:5000/translate";
  const fullTextChunks = splitText(story.fullText || story.summary || "");
  const input = [story.title || "", story.summary || "", ...fullTextChunks];
  const requestBody = {
    q: input,
    source: "ko",
    target: "en",
    format: "text"
  };
  if (config.libreTranslateApiKey) requestBody.api_key = config.libreTranslateApiKey;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`LibreTranslate antwortet mit HTTP ${response.status}.`);
  const payload = await response.json();
  const translated = Array.isArray(payload.translatedText) ? payload.translatedText : [payload.translatedText];
  if (translated.length !== input.length || translated.some(value => typeof value !== "string")) {
    throw new Error("LibreTranslate hat keine vollständige Übersetzung zurückgegeben.");
  }
  return {
    translatedTitle: translated[0].trim().slice(0, 256),
    translatedSummary: translated[1].trim().slice(0, 3500),
    translatedFullText: translated.slice(2).join("\n\n").trim(),
    translatedLanguage: "en"
  };
}
