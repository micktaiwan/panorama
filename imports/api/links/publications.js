import { Meteor } from 'meteor/meteor';
import { LinksCollection } from './collections';

Meteor.publish('links', function () {
  return LinksCollection.find({});
});

Meteor.publish('links.byProject', function (projectId) {
  if (!projectId) return this.ready();
  return LinksCollection.find({ projectId });
});


