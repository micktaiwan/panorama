import { Meteor } from 'meteor/meteor';
import { ClaudeCommandsCollection } from './collections';

Meteor.publish('claudeCommands', function publishClaudeCommands() {
  return ClaudeCommandsCollection.find({});
});
