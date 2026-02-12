import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth';
import { SituationQuestionsCollection } from './collections';

Meteor.methods({
  async 'situationQuestions.upsertForActor'(situationId, actorId, questions) {
    check(situationId, String);
    check(actorId, String);
    if (!Array.isArray(questions)) throw new Meteor.Error('invalid-arg', 'questions must be an array');
    const userId = requireUserId();
    const now = new Date();
    const existing = await SituationQuestionsCollection.findOneAsync({ situationId, actorId, userId });
    if (existing) {
      await requireOwnership(SituationQuestionsCollection, existing._id);
      await SituationQuestionsCollection.updateAsync({ _id: existing._id }, { $set: { questions, createdAt: now } });
      return existing._id;
    }
    const _id = await SituationQuestionsCollection.insertAsync({ situationId, actorId, questions, userId, createdAt: now });
    return _id;
  }
});


