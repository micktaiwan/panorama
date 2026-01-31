import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeMessagesCollection } from './collections';

Meteor.publish('claudeMessages.bySession', function publishClaudeMessages(sessionId) {
  check(sessionId, String);
  return ClaudeMessagesCollection.find(
    { sessionId },
    { sort: { createdAt: 1 }, limit: 200 }
  );
});
