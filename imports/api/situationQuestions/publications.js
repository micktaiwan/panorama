import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationQuestionsCollection } from './collections';

Meteor.publish('situationQuestions.forSituation', function (situationId) {
  if (!this.userId) return this.ready();
  check(situationId, String);
  return SituationQuestionsCollection.find({ situationId, userId: this.userId }, { fields: { situationId: 1, actorId: 1, questions: 1, createdAt: 1 } });
});


