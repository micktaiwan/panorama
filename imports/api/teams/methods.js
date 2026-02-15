import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { TeamsCollection } from './collections';
import { PeopleCollection } from '../people/collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'teams.insert'(fields) {
    ensureLoggedIn(this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const name = String(fields.name || '').trim();
    if (!name) throw new Meteor.Error('invalid-arg', 'name is required');
    const now = new Date();
    const _id = await TeamsCollection.insertAsync({ name, userId: this.userId, createdAt: now, updatedAt: now });
    return _id;
  },
  async 'teams.update'(id, fields) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(TeamsCollection, id, this.userId);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('name' in fields) updates.name = String(fields.name || '').trim();
    updates.updatedAt = new Date();
    await TeamsCollection.updateAsync({ _id: id }, { $set: updates });
  },
  async 'teams.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(TeamsCollection, id, this.userId);
    const members = await PeopleCollection.find({ teamId: id, userId: this.userId }).countAsync();
    if (members > 0) throw new Meteor.Error('team-not-empty', `Team has ${members} member(s)`);
    await TeamsCollection.removeAsync({ _id: id });
  },
  async 'teams.canRemove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(TeamsCollection, id, this.userId);
    const members = await PeopleCollection.find({ teamId: id, userId: this.userId }).countAsync();
    return { canRemove: members === 0, count: members };
  },
  async 'teams.removeAndReassign'(id, newTeamId) {
    check(id, String);
    if (newTeamId != null) check(newTeamId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(TeamsCollection, id, this.userId);
    if (newTeamId) {
      await ensureOwner(TeamsCollection, newTeamId, this.userId);
      await PeopleCollection.updateAsync({ teamId: id, userId: this.userId }, { $set: { teamId: newTeamId } }, { multi: true });
    } else {
      await PeopleCollection.updateAsync({ teamId: id, userId: this.userId }, { $unset: { teamId: 1 } }, { multi: true });
    }
    await TeamsCollection.removeAsync({ _id: id });
  }
});


