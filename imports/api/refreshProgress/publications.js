import { Meteor } from 'meteor/meteor';
import { RefreshProgressCollection } from './collections';

Meteor.publish('refreshProgress', function () {
  if (!this.userId) return this.ready();
  return RefreshProgressCollection.find({ userId: this.userId });
});
