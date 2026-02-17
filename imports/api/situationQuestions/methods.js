import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationQuestionsCollection } from './collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'situationQuestions.upsertForActor'(situationId, actorId, questions) {
    check(situationId, String);
    check(actorId, String);
    ensureLoggedIn(this.userId);
    if (!Array.isArray(questions)) throw new Meteor.Error('invalid-arg', 'questions must be an array');
    const now = new Date();
    const existing = await SituationQuestionsCollection.findOneAsync({ situationId, actorId, userId: this.userId });
    if (existing) {
      await SituationQuestionsCollection.updateAsync({ _id: existing._id }, { $set: { questions, createdAt: now } });
      return existing._id;
    }
    const _id = await SituationQuestionsCollection.insertAsync({ situationId, actorId, questions, userId: this.userId, createdAt: now });
    return _id;
  }
});


