import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationQuestionsCollection } from './collections';

Meteor.publish('situationQuestions.forSituation', function (situationId) {
  check(situationId, String);
  return SituationQuestionsCollection.find({ situationId }, { fields: { situationId: 1, actorId: 1, questions: 1, createdAt: 1 } });
});


