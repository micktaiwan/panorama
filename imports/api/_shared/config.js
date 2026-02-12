import { Meteor } from 'meteor/meteor';
import { AI_PREFERENCES_SCHEMA } from '/imports/api/appPreferences/collections';

// All secrets and infrastructure config come from Meteor.settings / env vars only.
// No more per-user DB lookups for API keys — this is server-level config.

const s = () => Meteor.settings || {};

// AI configuration helpers (server-level defaults)
export const getAIConfig = () => {
  const ai = s().ai || {};
  return {
    mode: ai.mode || AI_PREFERENCES_SCHEMA.mode.defaultValue,
    fallback: ai.fallback || AI_PREFERENCES_SCHEMA.fallback.defaultValue,
    timeoutMs: ai.timeoutMs || AI_PREFERENCES_SCHEMA.timeoutMs.defaultValue,
    maxTokens: ai.maxTokens || AI_PREFERENCES_SCHEMA.maxTokens.defaultValue,
    temperature: ai.temperature || AI_PREFERENCES_SCHEMA.temperature.defaultValue,
    local: { ...AI_PREFERENCES_SCHEMA.local.defaultValue, ...(ai.local || {}) },
    remote: { ...AI_PREFERENCES_SCHEMA.remote.defaultValue, ...(ai.remote || {}) }
  };
};

export const getOpenAiApiKey = () =>
  process.env.OPENAI_API_KEY || s().openai?.apiKey || null;

export const getAnthropicApiKey = () =>
  process.env.ANTHROPIC_API_KEY || s().anthropic?.apiKey || null;

export const getPennylaneConfig = () => ({
  baseUrl: s().pennylane?.baseUrl || null,
  token: process.env.PENNYLANE_TOKEN || s().pennylane?.token || null,
});

export const getQdrantUrl = () =>
  (process.env.QDRANT_URL || s().qdrantUrl || null)?.trim() || null;

export const getSlackConfig = () => ({
  enabled: s().slack?.enabled ?? false,
  botToken: process.env.SLACK_BOT_TOKEN || s().slack?.botToken || null,
  appToken: process.env.SLACK_APP_TOKEN || s().slack?.appToken || null,
  allowedUserId: process.env.SLACK_ALLOWED_USER_ID || s().slack?.allowedUserId || null,
});

export const getGoogleCalendarConfig = () => ({
  clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || s().googleCalendar?.clientId || null,
  clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || s().googleCalendar?.clientSecret || null,
  refreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || s().googleCalendar?.refreshToken || null,
  redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || s().googleCalendar?.redirectUri || 'http://localhost:3000/oauth/google-calendar/callback',
});


