import { Meteor } from 'meteor/meteor';
import { PeopleCollection } from './collections';

Meteor.publish('people.all', function () {
  return PeopleCollection.find({}, {
    fields: {
      name: 1,
      lastName: 1,
      normalizedName: 1,
      aliases: 1,
      role: 1,
      email: 1,
      notes: 1,
      left: 1,
      teamId: 1,
      createdAt: 1,
      updatedAt: 1
    }
  });
});


