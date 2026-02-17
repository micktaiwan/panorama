import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationSummariesCollection } from './collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'situationSummaries.upsert'(situationId, markdown) {
    check(situationId, String);
    ensureLoggedIn(this.userId);
    const text = String(markdown || '');
    const existing = await SituationSummariesCollection.findOneAsync({ situationId, userId: this.userId });
    const now = new Date();
    if (existing) {
      await SituationSummariesCollection.updateAsync({ _id: existing._id }, { $set: { markdown: text, createdAt: now } });
      return existing._id;
    }
    const _id = await SituationSummariesCollection.insertAsync({ situationId, markdown: text, userId: this.userId, createdAt: now });
    return _id;
  }
});


