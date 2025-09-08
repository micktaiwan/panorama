import { Meteor } from 'meteor/meteor';
import { ErrorsCollection } from './collections';

Meteor.publish('errors.recent', function () {
  return ErrorsCollection.find({}, { sort: { createdAt: -1 }, limit: 200 });
});


