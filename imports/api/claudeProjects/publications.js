import { Meteor } from 'meteor/meteor';
import { ClaudeProjectsCollection } from './collections';

Meteor.publish('claudeProjects', function publishClaudeProjects() {
  return ClaudeProjectsCollection.find({}, { sort: { updatedAt: -1 } });
});
