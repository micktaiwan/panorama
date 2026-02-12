import { Meteor } from 'meteor/meteor';
import { Files } from './collections';

Meteor.publish('files', function () {
  if (!this.userId) return this.ready();
  return Files.find({ userId: this.userId }).cursor;
});

Meteor.publish('files.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  const pid = typeof projectId === 'string' ? projectId : '__none__';
  return Files.find({ projectId: pid, userId: this.userId }).cursor;
});
