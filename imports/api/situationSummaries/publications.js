import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationSummariesCollection } from './collections';

Meteor.publish('situationSummaries.forSituation', function (situationId) {
  check(situationId, String);
  return SituationSummariesCollection.find({ situationId }, { fields: { situationId: 1, text: 1, createdAt: 1 } });
});
