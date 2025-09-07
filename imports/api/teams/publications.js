import { Meteor } from 'meteor/meteor';
import { TeamsCollection } from './collections';

Meteor.publish('teams.all', function () {
  return TeamsCollection.find({}, { fields: { name: 1, createdAt: 1, updatedAt: 1 } });
});


