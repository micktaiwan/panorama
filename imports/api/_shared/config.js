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

export const getGoogleCalendarConfig = () => {
  const pref = getPrefs();
  const clientId = pref?.googleCalendar?.clientId?.trim() || process.env.GOOGLE_CALENDAR_CLIENT_ID || Meteor.settings?.googleCalendar?.clientId || null;
  const clientSecret = pref?.googleCalendar?.clientSecret?.trim() || process.env.GOOGLE_CALENDAR_CLIENT_SECRET || Meteor.settings?.googleCalendar?.clientSecret || null;
  const refreshToken = pref?.googleCalendar?.refreshToken?.trim() || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || Meteor.settings?.googleCalendar?.refreshToken || null;
  const redirectUri = pref?.googleCalendar?.redirectUri?.trim() || process.env.GOOGLE_CALENDAR_REDIRECT_URI || Meteor.settings?.googleCalendar?.redirectUri || 'http://localhost:3000/oauth/google-calendar/callback';

  return { clientId, clientSecret, refreshToken, redirectUri };
};


