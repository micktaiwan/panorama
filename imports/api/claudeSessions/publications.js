import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeSessionsCollection } from './collections';

Meteor.publish('claudeSessions', function publishClaudeSessions() {
  if (!this.userId) return this.ready();
  return ClaudeSessionsCollection.find({ userId: this.userId }, { sort: { updatedAt: -1 } });
});

Meteor.publish('claudeSessions.byProject', function publishClaudeSessionsByProject(projectId) {
  if (!this.userId) return this.ready();
  check(projectId, String);
  return ClaudeSessionsCollection.find({ projectId, userId: this.userId }, { sort: { createdAt: 1 } });
});

Meteor.publish('claudeSessions.unseen', function publishClaudeSessionsUnseen() {
  if (!this.userId) return this.ready();
  return ClaudeSessionsCollection.find(
    { unseenCompleted: true, userId: this.userId },
    { fields: { projectId: 1, name: 1, status: 1, unseenCompleted: 1, updatedAt: 1 } }
  );
});
