import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { TeamsCollection } from './collections';
import { PeopleCollection } from '../people/collections';

Meteor.methods({
  async 'teams.insert'(fields) {
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const name = String(fields.name || '').trim();
    if (!name) throw new Meteor.Error('invalid-arg', 'name is required');
    const now = new Date();
    const _id = await TeamsCollection.insertAsync({ name, createdAt: now, updatedAt: now });
    return _id;
  },
  async 'teams.update'(id, fields) {
    check(id, String);
    if (!fields || typeof fields !== 'object') throw new Meteor.Error('invalid-arg', 'fields must be an object');
    const updates = {};
    if ('name' in fields) updates.name = String(fields.name || '').trim();
    updates.updatedAt = new Date();
    await TeamsCollection.updateAsync({ _id: id }, { $set: updates });
  },
  async 'teams.remove'(id) {
    check(id, String);
    const members = await PeopleCollection.find({ teamId: id }).countAsync();
    if (members > 0) throw new Meteor.Error('team-not-empty', `Team has ${members} member(s)`);
    await TeamsCollection.removeAsync({ _id: id });
  },
  async 'teams.canRemove'(id) {
    check(id, String);
    const members = await PeopleCollection.find({ teamId: id }).countAsync();
    return { canRemove: members === 0, count: members };
  },
  async 'teams.removeAndReassign'(id, newTeamId) {
    check(id, String);
    if (newTeamId != null) check(newTeamId, String);
    const exists = await TeamsCollection.findOneAsync({ _id: id });
    if (!exists) throw new Meteor.Error('not-found', 'Team not found');
    if (newTeamId) {
      const toTeam = await TeamsCollection.findOneAsync({ _id: newTeamId });
      if (!toTeam) throw new Meteor.Error('invalid-arg', 'Reassignment team not found');
      await PeopleCollection.updateAsync({ teamId: id }, { $set: { teamId: newTeamId } }, { multi: true });
    } else {
      await PeopleCollection.updateAsync({ teamId: id }, { $unset: { teamId: 1 } }, { multi: true });
    }
    await TeamsCollection.removeAsync({ _id: id });
  }
});


