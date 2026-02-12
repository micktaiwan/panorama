import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationSummariesCollection } from './collections';

Meteor.publish('situationSummaries.forSituation', function (situationId) {
  if (!this.userId) return this.ready();
  check(situationId, String);
  return SituationSummariesCollection.find({ situationId, userId: this.userId }, { fields: { situationId: 1, text: 1, createdAt: 1 } });
});
