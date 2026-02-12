import { Meteor } from 'meteor/meteor';
import { ErrorsCollection } from './collections';

Meteor.publish('errors.recent', function () {
  if (!this.userId) return this.ready();
  return ErrorsCollection.find({ userId: this.userId }, { sort: { createdAt: -1 }, limit: 200 });
});


