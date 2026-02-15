import { Meteor } from 'meteor/meteor';
import { PeopleCollection } from './collections';

Meteor.publish('people.all', function () {
  if (!this.userId) return this.ready();
  return PeopleCollection.find({ userId: this.userId }, {
    fields: {
      name: 1,
      lastName: 1,
      normalizedName: 1,
      aliases: 1,
      role: 1,
      email: 1,
      notes: 1,
      left: 1,
      contactOnly: 1,
      teamId: 1,
      arrivalDate: 1,
      subteam: 1,
      createdAt: 1,
      updatedAt: 1
    }
  });
});


