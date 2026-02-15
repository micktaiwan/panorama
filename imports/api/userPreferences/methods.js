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
    let doc = await UserPreferencesCollection.findOneAsync({ userId: this.userId });
    if (!doc) {
      const now = new Date();
      const id = await UserPreferencesCollection.insertAsync({
        userId: this.userId,
        theme: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        perplexityApiKey: null,
        ai: null,
        createdAt: now,
        updatedAt: now,
      });
      doc = await UserPreferencesCollection.findOneAsync(id);
    }

    // One-time migration: copy API keys from appPreferences
    if (!doc._keysBackfilled) {
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
      const appPref = await AppPreferencesCollection.findOneAsync({});
      const $set = { _keysBackfilled: true, updatedAt: new Date() };
      if (appPref) {
        for (const k of ['openaiApiKey', 'anthropicApiKey', 'perplexityApiKey']) {
          if (!doc[k] && appPref[k]) $set[k] = appPref[k];
        }
        if (!doc.ai && appPref.ai) $set.ai = appPref.ai;
      }
      await UserPreferencesCollection.updateAsync(doc._id, { $set });
    }

    // One-time migration: copy integration configs from appPreferences
    if (!doc._integrationsBackfilled) {
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
      const appPref = await AppPreferencesCollection.findOneAsync({});
      const $set = { _integrationsBackfilled: true, updatedAt: new Date() };
      if (appPref) {
        if (!doc.pennylaneBaseUrl && appPref.pennylaneBaseUrl) $set.pennylaneBaseUrl = appPref.pennylaneBaseUrl;
        if (!doc.pennylaneToken && appPref.pennylaneToken) $set.pennylaneToken = appPref.pennylaneToken;
        if (!doc.slack && appPref.slack) $set.slack = appPref.slack;
        if (!doc.googleCalendar && appPref.googleCalendar) $set.googleCalendar = appPref.googleCalendar;
        if (!doc.calendarIcsUrl && appPref.calendarIcsUrl) $set.calendarIcsUrl = appPref.calendarIcsUrl;
        if (!doc.cta && appPref.cta) $set.cta = appPref.cta;
      }
      await UserPreferencesCollection.updateAsync(doc._id, { $set });
    }

    return doc._id;
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

    // Integration fields (Pennylane, Slack, Google Calendar, CTA, ICS URL)
    if (typeof modifier.pennylaneBaseUrl === 'string') set.pennylaneBaseUrl = modifier.pennylaneBaseUrl.trim() || null;
    if (typeof modifier.pennylaneToken === 'string') set.pennylaneToken = modifier.pennylaneToken.trim() || null;
    if (typeof modifier.calendarIcsUrl === 'string') set.calendarIcsUrl = modifier.calendarIcsUrl.trim() || null;

    if (modifier.slack != null && typeof modifier.slack === 'object') {
      const slack = {};
      if (typeof modifier.slack.enabled === 'boolean') slack.enabled = modifier.slack.enabled;
      if (typeof modifier.slack.botToken === 'string') slack.botToken = modifier.slack.botToken.trim() || null;
      if (typeof modifier.slack.appToken === 'string') slack.appToken = modifier.slack.appToken.trim() || null;
      if (typeof modifier.slack.allowedUserId === 'string') slack.allowedUserId = modifier.slack.allowedUserId.trim() || null;
      if (Object.keys(slack).length > 0) set.slack = slack;
    }

    if (modifier.googleCalendar != null && typeof modifier.googleCalendar === 'object') {
      const gc = {};
      if (typeof modifier.googleCalendar.clientId === 'string') gc.clientId = modifier.googleCalendar.clientId.trim() || null;
      if (typeof modifier.googleCalendar.clientSecret === 'string') gc.clientSecret = modifier.googleCalendar.clientSecret.trim() || null;
      if (typeof modifier.googleCalendar.refreshToken === 'string') gc.refreshToken = modifier.googleCalendar.refreshToken.trim() || null;
      if (typeof modifier.googleCalendar.redirectUri === 'string') gc.redirectUri = modifier.googleCalendar.redirectUri.trim() || null;
      if (modifier.googleCalendar.lastSyncAt !== undefined) gc.lastSyncAt = modifier.googleCalendar.lastSyncAt;
      if (Object.keys(gc).length > 0) set.googleCalendar = gc;
    }

    if (modifier.cta != null && typeof modifier.cta === 'object') {
      const cta = {};
      if (typeof modifier.cta.enabled === 'boolean') cta.enabled = modifier.cta.enabled;
      if (typeof modifier.cta.model === 'string') cta.model = modifier.cta.model;
      if (Object.keys(cta).length > 0) set.cta = cta;
    }

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
