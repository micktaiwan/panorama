import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { AppPreferencesCollection } from './collections';
import { requireUserId } from '/imports/api/_shared/auth';

const normalizePath = (p) => String(p || '').trim();

Meteor.methods({
  async 'appPreferences.ensure'() {
    const userId = requireUserId();
    const doc = await AppPreferencesCollection.findOneAsync({ userId });
    if (doc) return doc._id;
    const now = new Date();
    return AppPreferencesCollection.insertAsync({
      userId,
      createdAt: now,
      updatedAt: now,
      filesDir: null,
      onboardedAt: null,
      devUrlMode: false,
      theme: 'dark',
      settingsVersion: 1
    });
  },
  async 'appPreferences.update'(modifier) {
    check(modifier, Object);
    const userId = requireUserId();
    const set = { updatedAt: new Date() };
    // User-level preferences only — API keys are now in Meteor.settings / env vars
    if (typeof modifier.filesDir === 'string') set.filesDir = normalizePath(modifier.filesDir) || null;
    if (modifier.onboardedAt === true) set.onboardedAt = new Date();
    if (typeof modifier.devUrlMode === 'boolean') set.devUrlMode = modifier.devUrlMode;
    if (modifier.theme === 'dark' || modifier.theme === 'light') set.theme = modifier.theme;
    if (Number.isFinite(modifier.settingsVersion)) set.settingsVersion = modifier.settingsVersion;
    const doc = await AppPreferencesCollection.findOneAsync({ userId });
    if (!doc) {
      await AppPreferencesCollection.insertAsync({ ...set, userId, createdAt: new Date() });
      return true;
    }
    await AppPreferencesCollection.updateAsync(doc._id, { $set: set });
    return true;
  }
});


