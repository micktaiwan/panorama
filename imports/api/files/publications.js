import { Meteor } from 'meteor/meteor';
import { FilesCollection } from './collections';

Meteor.publish('files', function () {
  if (!this.userId) return this.ready();
  return FilesCollection.find({ userId: this.userId });
});

Meteor.publish('files.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  const pid = typeof projectId === 'string' ? projectId : '__none__';
  return FilesCollection.find({ userId: this.userId, projectId: pid });
});


