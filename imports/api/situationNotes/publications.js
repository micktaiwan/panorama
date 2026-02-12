import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationNotesCollection } from './collections';

Meteor.publish('situationNotes.forSituation', function (situationId) {
  if (!this.userId) return this.ready();
  check(situationId, String);
  return SituationNotesCollection.find({ situationId, userId: this.userId }, { fields: { situationId: 1, actorId: 1, content: 1, createdAt: 1 } });
});


