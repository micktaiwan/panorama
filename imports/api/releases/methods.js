import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ReleasesCollection } from './collections';
import { ensureLoggedIn, ensureAdmin } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'releases.insert'({ version, title, content }) {
    check(version, String);
    check(title, String);
    check(content, String);
    ensureLoggedIn(this.userId);

    const now = new Date();
    const id = await ReleasesCollection.insertAsync({
      version: version.trim(),
      title: title.trim(),
      content,
      createdBy: this.userId,
      createdAt: now,
    });
    return id;
  },

  async 'releases.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);

    const doc = await ReleasesCollection.findOneAsync(id);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Release not found');
    }
    if (doc.createdBy !== this.userId) {
      await ensureAdmin(this.userId);
    }
    return ReleasesCollection.removeAsync(id);
  },
});
