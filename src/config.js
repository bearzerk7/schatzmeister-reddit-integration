import "dotenv/config";

function parseIdList(value) {
  return String(value || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  adminRoleIds: parseIdList(
    process.env.DKP_ADMIN_ROLE_IDS
  ),

  adminUserIds: parseIdList(
    process.env.DKP_ADMIN_USER_IDS
  ),

  pollAdminRoleIds: parseIdList(
    process.env.POLL_ADMIN_ROLE_IDS || process.env.DKP_ADMIN_ROLE_IDS
  ),

  pollAdminUserIds: parseIdList(
    process.env.POLL_ADMIN_USER_IDS || process.env.DKP_ADMIN_USER_IDS
  ),
  logChannelId: process.env.DKP_LOG_CHANNEL_ID || null,
  newsChannelId: process.env.NEWS_CHANNEL_ID || null,
  newsPollIntervalMinutes: Math.min(60, Math.max(5, Number(process.env.NEWS_POLL_INTERVAL_MINUTES) || 10)),
  newsTranslationEnabled: parseBoolean(process.env.NEWS_TRANSLATION_ENABLED, false),
  libreTranslateUrl: process.env.LIBRETRANSLATE_URL || "http://127.0.0.1:5000/translate",
  libreTranslateApiKey: process.env.LIBRETRANSLATE_API_KEY || null,
  newsSources: {
    korea: parseBoolean(process.env.NEWS_SOURCE_KOREA, true),
    global: parseBoolean(process.env.NEWS_SOURCE_GLOBAL, true),
    ncsoft: parseBoolean(process.env.NEWS_SOURCE_NCSOFT, true),
    steam: parseBoolean(process.env.NEWS_SOURCE_STEAM, true),
    shugo: parseBoolean(process.env.NEWS_SOURCE_SHUGO, true),
    inven: parseBoolean(process.env.NEWS_SOURCE_INVEN, true),
    dcinside: parseBoolean(process.env.NEWS_SOURCE_DCINSIDE, true)
  },

  features: {
    dkp: parseBoolean(process.env.FEATURE_DKP, true),
    polls: parseBoolean(process.env.FEATURE_POLLS, true),
    news: parseBoolean(process.env.FEATURE_NEWS, true)
  }
};

if (!config.token) throw new Error("DISCORD_TOKEN fehlt in .env");
if (!config.clientId) throw new Error("CLIENT_ID fehlt in .env");
if (!config.guildId) throw new Error("GUILD_ID fehlt in .env");
