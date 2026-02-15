import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationsCollection } from './collections';
import { SituationActorsCollection } from '/imports/api/situationActors/collections';
import { SituationNotesCollection } from '/imports/api/situationNotes/collections';
import { SituationQuestionsCollection } from '/imports/api/situationQuestions/collections';
import { SituationSummariesCollection } from '/imports/api/situationSummaries/collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'situations.insert'(fields) {
    ensureLoggedIn(this.userId);
    if (fields && typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const title = String(fields?.title || 'New Situation').trim();
    const description = String(fields?.description || '').trim();
    const now = new Date();
    const _id = await SituationsCollection.insertAsync({ title, description, userId: this.userId, createdAt: now, updatedAt: now });
    return _id;
  },
  async 'situations.update'(id, fields) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(SituationsCollection, id, this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('title' in fields) updates.title = String(fields.title || '').trim();
    if ('description' in fields) updates.description = String(fields.description || '').trim();
    updates.updatedAt = new Date();
    await SituationsCollection.updateAsync({ _id: id }, { $set: updates });
  },
  async 'situations.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(SituationsCollection, id, this.userId);
    // Cascade: remove dependents first, then the situation
    await SituationNotesCollection.removeAsync({ situationId: id, userId: this.userId });
    await SituationQuestionsCollection.removeAsync({ situationId: id, userId: this.userId });
    await SituationSummariesCollection.removeAsync({ situationId: id, userId: this.userId });
    await SituationActorsCollection.removeAsync({ situationId: id, userId: this.userId });
    await SituationsCollection.removeAsync({ _id: id });
  }
});


