import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeMessagesCollection } from './collections';

Meteor.publish('claudeMessages.bySession', function publishClaudeMessages(sessionId) {
  if (!this.userId) return this.ready();
  check(sessionId, String);
  return ClaudeMessagesCollection.find(
    { sessionId, userId: this.userId },
    { sort: { createdAt: 1 } }
  );
});
