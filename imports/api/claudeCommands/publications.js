import { Meteor } from 'meteor/meteor';
import { ClaudeCommandsCollection } from './collections';

Meteor.publish('claudeCommands', function publishClaudeCommands() {
  if (!this.userId) return this.ready();
  return ClaudeCommandsCollection.find({ userId: this.userId });
});
