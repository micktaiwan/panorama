import { Meteor } from 'meteor/meteor';
import { ErrorsCollection } from './collections';

Meteor.publish('errors.recent', function () {
  if (!this.userId) return this.ready();
  return ErrorsCollection.find({ $or: [{ userId: this.userId }, { userId: null }] }, { sort: { createdAt: -1 }, limit: 200 });
});


