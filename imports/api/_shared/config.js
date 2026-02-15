import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection, AI_PREFERENCES_SCHEMA } from '/imports/api/appPreferences/collections';

// Lightweight cached preferences for synchronous reads in server code
let PREFS_CACHE = null;
if (Meteor.isServer) {
  Meteor.startup(async () => {
    PREFS_CACHE = await AppPreferencesCollection.findOneAsync({});
    AppPreferencesCollection.find({}, { limit: 1 }).observe({
      added: (doc) => { PREFS_CACHE = doc; },
      changed: (newDoc) => { PREFS_CACHE = newDoc; },
      removed: () => { PREFS_CACHE = null; }
    });
  });
}
const getPrefs = () => PREFS_CACHE;

// AI configuration helpers
export const getAIConfig = () => {
  const prefs = getPrefs();
  const defaults = {
    mode: AI_PREFERENCES_SCHEMA.mode.defaultValue,
    fallback: AI_PREFERENCES_SCHEMA.fallback.defaultValue,
    timeoutMs: AI_PREFERENCES_SCHEMA.timeoutMs.defaultValue,
    maxTokens: AI_PREFERENCES_SCHEMA.maxTokens.defaultValue,
    temperature: AI_PREFERENCES_SCHEMA.temperature.defaultValue,
    local: { ...AI_PREFERENCES_SCHEMA.local.defaultValue },
    remote: { ...AI_PREFERENCES_SCHEMA.remote.defaultValue }
  };
  
  if (!prefs?.ai) {
    return defaults;
  }
  
  const config = {
    mode: prefs.ai.mode || defaults.mode,
    fallback: prefs.ai.fallback || defaults.fallback,
    timeoutMs: prefs.ai.timeoutMs || defaults.timeoutMs,
    maxTokens: prefs.ai.maxTokens || defaults.maxTokens,
    temperature: prefs.ai.temperature || defaults.temperature,
    local: { ...defaults.local, ...(prefs.ai.local || {}) },
    remote: { ...defaults.remote, ...(prefs.ai.remote || {}) }
  };
  
  return config;
};

export const getOpenAiApiKey = () => {
  const pref = getPrefs();
  const fromPrefs = pref?.openaiApiKey?.trim() || null;
  return fromPrefs || process.env.OPENAI_API_KEY || Meteor.settings?.openai?.apiKey || null;
};

export const getAnthropicApiKey = () => {
  const pref = getPrefs();
  const fromPrefs = pref?.anthropicApiKey?.trim() || null;
  return fromPrefs || process.env.ANTHROPIC_API_KEY || Meteor.settings?.anthropic?.apiKey || null;
};

export const getPennylaneConfig = () => {
  const pref = getPrefs();
  const baseUrl = pref?.pennylaneBaseUrl?.trim() || Meteor.settings?.pennylane?.baseUrl || null;
  const token = pref?.pennylaneToken?.trim() || process.env.PENNYLANE_TOKEN || Meteor.settings?.pennylane?.token || null;
  return { baseUrl, token };
};

export const getQdrantUrl = () => {
  const pref = getPrefs();
  const fromPrefs = pref?.qdrantUrl?.trim();
  const url = fromPrefs || process.env.QDRANT_URL || Meteor.settings?.qdrantUrl || null;
  return url?.trim() || null;
};

export const getSlackConfig = () => {
  const pref = getPrefs();
  return {
    enabled: pref?.slack?.enabled ?? false,
    botToken: pref?.slack?.botToken?.trim() || process.env.SLACK_BOT_TOKEN || null,
    appToken: pref?.slack?.appToken?.trim() || process.env.SLACK_APP_TOKEN || null,
    allowedUserId: pref?.slack?.allowedUserId?.trim() || process.env.SLACK_ALLOWED_USER_ID || null,
  };
};

export const getGoogleCalendarConfig = () => {
  const pref = getPrefs();
  const clientId = pref?.googleCalendar?.clientId?.trim() || process.env.GOOGLE_CALENDAR_CLIENT_ID || Meteor.settings?.googleCalendar?.clientId || null;
  const clientSecret = pref?.googleCalendar?.clientSecret?.trim() || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || Meteor.settings?.googleCalendar?.clientSecret || null;
  const refreshToken = pref?.googleCalendar?.refreshToken?.trim() || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || Meteor.settings?.googleCalendar?.refreshToken || null;
  const redirectUri = pref?.googleCalendar?.redirectUri?.trim() || process.env.GOOGLE_CALENDAR_REDIRECT_URI || Meteor.settings?.googleCalendar?.redirectUri || 'http://localhost:3000/oauth/google-calendar/callback';

  return { clientId, clientSecret, refreshToken, redirectUri };
};

// --- Async user-aware getters (for Meteor method context) ---
// Merge: userPreferences > appPreferences > env > settings

const getUserPrefs = async (userId) => {
  if (!userId) return null;
  const { UserPreferencesCollection } = await import('/imports/api/userPreferences/collections');
  return UserPreferencesCollection.findOneAsync({ userId });
};

export const getOpenAiApiKeyAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  const fromUser = userPref?.openaiApiKey?.trim() || null;
  if (fromUser) return fromUser;
  return getOpenAiApiKey();
};

export const getAnthropicApiKeyAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  const fromUser = userPref?.anthropicApiKey?.trim() || null;
  if (fromUser) return fromUser;
  return getAnthropicApiKey();
};

export const getAIConfigAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  const base = getAIConfig(); // instance-level defaults
  if (!userPref?.ai) return base;
  // Merge user overrides on top of instance config
  return {
    mode: userPref.ai.mode || base.mode,
    fallback: userPref.ai.fallback || base.fallback,
    timeoutMs: userPref.ai.timeoutMs || base.timeoutMs,
    maxTokens: userPref.ai.maxTokens || base.maxTokens,
    temperature: userPref.ai.temperature ?? base.temperature,
    local: { ...base.local, ...(userPref.ai.local || {}) },
    remote: { ...base.remote, ...(userPref.ai.remote || {}) }
  };
};

export const getPennylaneConfigAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  const fromUser = {
    baseUrl: userPref?.pennylaneBaseUrl?.trim() || null,
    token: userPref?.pennylaneToken?.trim() || null,
  };
  if (fromUser.baseUrl && fromUser.token) return fromUser;
  return getPennylaneConfig(); // fallback to instance-level
};

export const getSlackConfigAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  if (userPref?.slack) {
    return {
      enabled: userPref.slack.enabled ?? false,
      botToken: userPref.slack.botToken?.trim() || null,
      appToken: userPref.slack.appToken?.trim() || null,
      allowedUserId: userPref.slack.allowedUserId?.trim() || null,
    };
  }
  return getSlackConfig(); // fallback to instance-level
};

export const getGoogleCalendarConfigAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  if (userPref?.googleCalendar) {
    const gc = userPref.googleCalendar;
    return {
      clientId: gc.clientId?.trim() || null,
      clientSecret: gc.clientSecret?.trim() || null,
      refreshToken: gc.refreshToken?.trim() || null,
      redirectUri: gc.redirectUri?.trim() || null,
    };
  }
  return getGoogleCalendarConfig(); // fallback to instance-level
};

export const getCtaConfigAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  if (userPref?.cta) {
    return {
      enabled: userPref.cta.enabled ?? false,
      model: userPref.cta.model || null,
    };
  }
  // fallback to appPreferences
  const pref = getPrefs();
  return {
    enabled: pref?.cta?.enabled ?? false,
    model: pref?.cta?.model || null,
  };
};

export const getCalendarIcsUrlAsync = async (userId) => {
  const userPref = await getUserPrefs(userId);
  const fromUser = userPref?.calendarIcsUrl?.trim() || null;
  if (fromUser) return fromUser;
  // fallback to appPreferences
  const pref = getPrefs();
  return pref?.calendarIcsUrl?.trim() || null;
};

/**
 * Read localUserId from appPreferences (for MCP server context).
 */
export const getLocalUserId = () => {
  const pref = getPrefs();
  return pref?.localUserId || null;
};


