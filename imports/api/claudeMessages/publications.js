import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeMessagesCollection } from './collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';

Meteor.publish('claudeMessages.bySession', async function publishClaudeMessages(sessionId) {
  if (!this.userId) return this.ready();
  check(sessionId, String);
  // Verify the session belongs to this user
  const session = await ClaudeSessionsCollection.findOneAsync({ _id: sessionId, userId: this.userId });
  if (!session) return this.ready();
  return ClaudeMessagesCollection.find(
    { sessionId },
    { sort: { createdAt: 1 } }
  );
});
