import { Meteor } from 'meteor/meteor';
import { TeamsCollection } from './collections';

Meteor.publish('teams.all', function () {
  if (!this.userId) return this.ready();
  return TeamsCollection.find({ userId: this.userId }, { fields: { name: 1, createdAt: 1, updatedAt: 1 } });
});


