import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AppPreferencesCollection } from './collections';

const normalizePath = (p) => String(p || '').trim();

Meteor.methods({
  async 'appPreferences.ensure'() {
    const doc = await AppPreferencesCollection.findOneAsync({});
    if (doc) return doc._id;
    const now = new Date();
    return AppPreferencesCollection.insertAsync({
      createdAt: now,
      updatedAt: now,
      filesDir: null,
      onboardedAt: null,
      devUrlMode: false,
      settingsVersion: 1
    });
  },
  async 'appPreferences.update'(modifier) {
    check(modifier, Object);
    const set = { updatedAt: new Date() };
    if (typeof modifier.filesDir === 'string') set.filesDir = normalizePath(modifier.filesDir) || null;
    if (modifier.onboardedAt === true) set.onboardedAt = new Date();
    if (typeof modifier.devUrlMode === 'boolean') set.devUrlMode = modifier.devUrlMode;
    if (Number.isFinite(modifier.settingsVersion)) set.settingsVersion = modifier.settingsVersion;
    const doc = await AppPreferencesCollection.findOneAsync({});
    if (!doc) {
      await AppPreferencesCollection.insertAsync({ ...set, createdAt: new Date() });
      return true;
    }
    await AppPreferencesCollection.updateAsync(doc._id, { $set: set });
    return true;
  }
});


