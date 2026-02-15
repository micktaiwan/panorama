import { Meteor } from 'meteor/meteor';
import { ReleasesCollection } from './collections';

Meteor.publish('releases.all', function publishReleases() {
  if (!this.userId) return this.ready();
  return ReleasesCollection.find({}, { sort: { createdAt: -1 }, limit: 50 });
});
