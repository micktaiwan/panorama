import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';

// Lightweight cached preferences for synchronous reads in server code
let PREFS_CACHE = null;
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      PREFS_CACHE = await AppPreferencesCollection.findOneAsync({});
    } catch (_e) {
      PREFS_CACHE = null;
    }
    AppPreferencesCollection.find({}, { limit: 1 }).observe({
      added: (doc) => { PREFS_CACHE = doc; },
      changed: (newDoc) => { PREFS_CACHE = newDoc; },
      removed: () => { PREFS_CACHE = null; }
    });
  });
}
const getPrefs = () => PREFS_CACHE;

export const getOpenAiApiKey = () => {
  const pref = getPrefs();
  const fromPrefs = pref && typeof pref.openaiApiKey === 'string' && pref.openaiApiKey.trim() ? pref.openaiApiKey.trim() : null;
  return fromPrefs || process.env.OPENAI_API_KEY || Meteor.settings?.openai?.apiKey || null;
};

export const getPennylaneConfig = () => {
  const pref = getPrefs();
  const baseUrl = (pref?.pennylaneBaseUrl && pref.pennylaneBaseUrl.trim()) || (Meteor.settings?.pennylane?.baseUrl) || null;
  const token = (pref?.pennylaneToken && pref.pennylaneToken.trim()) || process.env.PENNYLANE_TOKEN || (Meteor.settings?.pennylane?.token) || null;
  return { baseUrl, token };
};

export const getQdrantUrl = () => {
  const pref = getPrefs();
  const fromPrefs = pref?.qdrantUrl && pref.qdrantUrl.trim();
  const url = fromPrefs || process.env.QDRANT_URL || Meteor.settings?.qdrantUrl || null;
  return url && String(url).trim() ? String(url).trim() : null;
};


