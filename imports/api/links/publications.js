import { Meteor } from 'meteor/meteor';
import { LinksCollection } from './collections';

Meteor.publish('links', function () {
  if (!this.userId) return this.ready();
  return LinksCollection.find({ userId: this.userId });
});

Meteor.publish('links.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  if (!projectId) return this.ready();
  return LinksCollection.find({ projectId, userId: this.userId });
});


