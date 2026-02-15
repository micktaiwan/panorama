import { Meteor } from 'meteor/meteor';
import { ClaudeProjectsCollection } from './collections';

Meteor.publish('claudeProjects', function publishClaudeProjects() {
  if (!this.userId) return this.ready();
  return ClaudeProjectsCollection.find({ userId: this.userId }, { sort: { updatedAt: -1 } });
});
