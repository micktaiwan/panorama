import { Meteor } from 'meteor/meteor';
import { FilesCollection } from './collections';

Meteor.publish('files', function () {
  return FilesCollection.find({});
});

Meteor.publish('files.byProject', function (projectId) {
  const pid = typeof projectId === 'string' ? projectId : '__none__';
  return FilesCollection.find({ projectId: pid });
});


