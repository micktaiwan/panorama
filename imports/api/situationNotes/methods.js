import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationNotesCollection } from './collections';

Meteor.methods({
  async 'situationNotes.insert'(fields) {
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const situationId = String(fields.situationId || '');
    if (!situationId) throw new Meteor.Error('invalid-arg', 'situationId is required');
    const actorId = fields.actorId ? String(fields.actorId) : null;
    const content = String(fields.content || '').trim();
    const now = new Date();
    const _id = await SituationNotesCollection.insertAsync({ situationId, actorId, content, createdAt: now });
    return _id;
  },
  async 'situationNotes.update'(id, fields) {
    check(id, String);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('content' in fields) updates.content = String(fields.content || '').trim();
    await SituationNotesCollection.updateAsync({ _id: id }, { $set: updates });
  },
  async 'situationNotes.remove'(id) {
    check(id, String);
    await SituationNotesCollection.removeAsync({ _id: id });
  }
});


