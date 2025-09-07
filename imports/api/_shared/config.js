import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';

export const getOpenAiApiKey = () => {
  const pref = AppPreferencesCollection.findOne({});
  const fromPrefs = pref && typeof pref.openaiApiKey === 'string' && pref.openaiApiKey.trim() ? pref.openaiApiKey.trim() : null;
  return fromPrefs || process.env.OPENAI_API_KEY || Meteor.settings?.openai?.apiKey || null;
};

export const getPennylaneConfig = () => {
  const pref = AppPreferencesCollection.findOne({});
  const baseUrl = (pref?.pennylaneBaseUrl && pref.pennylaneBaseUrl.trim()) || (Meteor.settings?.pennylane?.baseUrl) || null;
  const token = (pref?.pennylaneToken && pref.pennylaneToken.trim()) || process.env.PENNYLANE_TOKEN || (Meteor.settings?.pennylane?.token) || null;
  return { baseUrl, token };
};

export const getQdrantUrl = () => {
  const pref = AppPreferencesCollection.findOne({});
  const fromPrefs = pref?.qdrantUrl && pref.qdrantUrl.trim();
  return fromPrefs || process.env.QDRANT_URL || Meteor.settings?.qdrantUrl || 'http://localhost:6333';
};


