import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UserPreferencesCollection } from './collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  /**
   * Ensure a preferences doc exists for the current user.
   * Returns the _id of the existing or newly created doc.
   */
  async 'userPreferences.ensure'() {
    ensureLoggedIn(this.userId);
    const doc = await UserPreferencesCollection.findOneAsync({ userId: this.userId });
    if (doc) return doc._id;
    const now = new Date();
    return UserPreferencesCollection.insertAsync({
      userId: this.userId,
      theme: null,
      openaiApiKey: null,
      anthropicApiKey: null,
      perplexityApiKey: null,
      ai: null,
      createdAt: now,
      updatedAt: now,
    });
  },

  /**
   * Partial update of user preferences.
   * Only the fields present in `modifier` are written.
   */
  async 'userPreferences.update'(modifier) {
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    const set = { updatedAt: new Date() };

    if (modifier.theme === 'dark' || modifier.theme === 'light') set.theme = modifier.theme;
    if (typeof modifier.openaiApiKey === 'string') set.openaiApiKey = modifier.openaiApiKey.trim() || null;
    if (typeof modifier.anthropicApiKey === 'string') set.anthropicApiKey = modifier.anthropicApiKey.trim() || null;
    if (typeof modifier.perplexityApiKey === 'string') set.perplexityApiKey = modifier.perplexityApiKey.trim() || null;

    // AI config sub-object
    if (modifier.ai != null && typeof modifier.ai === 'object') {
      const ai = {};
      if (['local', 'remote'].includes(modifier.ai.mode)) ai.mode = modifier.ai.mode;
      if (['none', 'local', 'remote'].includes(modifier.ai.fallback)) ai.fallback = modifier.ai.fallback;
      if (Number.isFinite(modifier.ai.timeoutMs)) ai.timeoutMs = modifier.ai.timeoutMs;
      if (Number.isFinite(modifier.ai.maxTokens)) ai.maxTokens = modifier.ai.maxTokens;
      if (Number.isFinite(modifier.ai.temperature)) ai.temperature = modifier.ai.temperature;
      if (modifier.ai.local && typeof modifier.ai.local === 'object') ai.local = modifier.ai.local;
      if (modifier.ai.remote && typeof modifier.ai.remote === 'object') ai.remote = modifier.ai.remote;
      if (Object.keys(ai).length > 0) set.ai = ai;
    }

    const doc = await UserPreferencesCollection.findOneAsync({ userId: this.userId });
    if (!doc) {
      await UserPreferencesCollection.insertAsync({ userId: this.userId, ...set, createdAt: new Date() });
      return true;
    }
    await UserPreferencesCollection.updateAsync(doc._id, { $set: set });
    return true;
  }
});
