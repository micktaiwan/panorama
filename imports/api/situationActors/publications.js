import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationActorsCollection } from './collections';

Meteor.publish('situationActors.forSituation', function (situationId) {
  if (!this.userId) return this.ready();
  check(situationId, String);
  return SituationActorsCollection.find({ situationId, userId: this.userId }, { fields: { situationId: 1, personId: 1, name: 1, role: 1, situationRole: 1, createdAt: 1, updatedAt: 1 } });
});


