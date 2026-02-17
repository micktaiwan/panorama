import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { AppPreferencesCollection } from './collections';

Meteor.methods({
  async 'appPreferences.ensure'() {
    const doc = await AppPreferencesCollection.findOneAsync({});
    if (doc) return doc._id;
    const now = new Date();
    return AppPreferencesCollection.insertAsync({
      createdAt: now,
      updatedAt: now,
      openaiApiKey: null,
      anthropicApiKey: null,
      perplexityApiKey: null,
      pennylaneBaseUrl: null,
      pennylaneToken: null,
      settingsVersion: 1
    });
  },
  async 'appPreferences.update'(modifier) {
    check(modifier, Object);
    const set = { updatedAt: new Date() };
    if (typeof modifier.openaiApiKey === 'string') set.openaiApiKey = modifier.openaiApiKey.trim() || null;
    if (typeof modifier.anthropicApiKey === 'string') set.anthropicApiKey = modifier.anthropicApiKey.trim() || null;
    if (typeof modifier.perplexityApiKey === 'string') set.perplexityApiKey = modifier.perplexityApiKey.trim() || null;
    if (typeof modifier.pennylaneBaseUrl === 'string') set.pennylaneBaseUrl = modifier.pennylaneBaseUrl.trim() || null;
    if (typeof modifier.pennylaneToken === 'string') set.pennylaneToken = modifier.pennylaneToken.trim() || null;
    if (modifier.slack !== null && modifier.slack !== undefined && typeof modifier.slack === 'object') {
      const s = modifier.slack;
      const slack = {};
      if (typeof s.enabled === 'boolean') slack.enabled = s.enabled;
      if (typeof s.botToken === 'string') slack.botToken = s.botToken.trim() || null;
      if (typeof s.appToken === 'string') slack.appToken = s.appToken.trim() || null;
      if (typeof s.allowedUserId === 'string') slack.allowedUserId = s.allowedUserId.trim() || null;
      set.slack = slack;
    }
    if (modifier.theme === 'dark' || modifier.theme === 'light') set.theme = modifier.theme;
    if (Number.isFinite(modifier.settingsVersion)) set.settingsVersion = modifier.settingsVersion;
    if (typeof modifier.localUserId === 'string') set.localUserId = modifier.localUserId.trim() || null;
    const doc = await AppPreferencesCollection.findOneAsync({});
    if (!doc) {
      await AppPreferencesCollection.insertAsync({ ...set, createdAt: new Date() });
      return true;
    }
    await AppPreferencesCollection.updateAsync(doc._id, { $set: set });
    return true;
  }
});


