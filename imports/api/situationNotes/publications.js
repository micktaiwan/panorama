import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationNotesCollection } from './collections';

Meteor.publish('situationNotes.forSituation', function (situationId) {
  check(situationId, String);
  return SituationNotesCollection.find({ situationId }, { fields: { situationId: 1, actorId: 1, content: 1, createdAt: 1 } });
});


