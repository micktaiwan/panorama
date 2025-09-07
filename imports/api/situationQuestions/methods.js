import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationQuestionsCollection } from './collections';

Meteor.methods({
  async 'situationQuestions.upsertForActor'(situationId, actorId, questions) {
    check(situationId, String);
    check(actorId, String);
    if (!Array.isArray(questions)) throw new Meteor.Error('invalid-arg', 'questions must be an array');
    const now = new Date();
    const existing = await SituationQuestionsCollection.findOneAsync({ situationId, actorId });
    if (existing) {
      await SituationQuestionsCollection.updateAsync({ _id: existing._id }, { $set: { questions, createdAt: now } });
      return existing._id;
    }
    const _id = await SituationQuestionsCollection.insertAsync({ situationId, actorId, questions, createdAt: now });
    return _id;
  }
});


