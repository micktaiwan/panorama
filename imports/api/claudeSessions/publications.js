import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeSessionsCollection } from './collections';

Meteor.publish('claudeSessions', function publishClaudeSessions() {
  return ClaudeSessionsCollection.find({}, { sort: { updatedAt: -1 } });
});

Meteor.publish('claudeSessions.byProject', function publishClaudeSessionsByProject(projectId) {
  check(projectId, String);
  return ClaudeSessionsCollection.find({ projectId }, { sort: { createdAt: 1 } });
});

Meteor.publish('claudeSessions.unseen', function publishClaudeSessionsUnseen() {
  return ClaudeSessionsCollection.find(
    { unseenCompleted: true },
    { fields: { projectId: 1, name: 1, status: 1, unseenCompleted: 1, updatedAt: 1 } }
  );
});
