import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SituationActorsCollection } from './collections';
import { SituationNotesCollection } from '/imports/api/situationNotes/collections';

Meteor.methods({
  async 'situationActors.insert'(fields) {
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const situationId = String(fields.situationId || '');
    if (!situationId) throw new Meteor.Error('invalid-arg', 'situationId is required');
    const name = String(fields.name || '').trim();
    const role = String(fields.role || '').trim();
    const situationRole = String(fields.situationRole || '').trim();
    const personId = fields.personId ? String(fields.personId) : undefined;
    const now = new Date();
    const doc = { situationId, name, role, situationRole, createdAt: now, updatedAt: now };
    if (personId) doc.personId = personId;
    const _id = await SituationActorsCollection.insertAsync(doc);
    return _id;
  },
  async 'situationActors.update'(id, fields) {
    check(id, String);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('name' in fields) updates.name = String(fields.name || '').trim();
    if ('role' in fields) updates.role = String(fields.role || '').trim();
    if ('situationRole' in fields) updates.situationRole = String(fields.situationRole || '').trim();
    if ('personId' in fields) updates.personId = fields.personId ? String(fields.personId) : undefined;
    updates.updatedAt = new Date();
    await SituationActorsCollection.updateAsync({ _id: id }, { $set: updates });
  },
  async 'situationActors.remove'(id) {
    check(id, String);
    // Also remove associated notes
    await SituationNotesCollection.removeAsync({ actorId: id });
    await SituationActorsCollection.removeAsync({ _id: id });
  }
});
