import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth';
import { SituationSummariesCollection } from './collections';

Meteor.methods({
  async 'situationSummaries.upsert'(situationId, markdown) {
    check(situationId, String);
    const userId = requireUserId();
    const text = String(markdown || '');
    const existing = await SituationSummariesCollection.findOneAsync({ situationId, userId });
    const now = new Date();
    if (existing) {
      await requireOwnership(SituationSummariesCollection, existing._id);
      await SituationSummariesCollection.updateAsync({ _id: existing._id }, { $set: { markdown: text, createdAt: now } });
      return existing._id;
    }
    const _id = await SituationSummariesCollection.insertAsync({ situationId, markdown: text, userId, createdAt: now });
    return _id;
  }
});


