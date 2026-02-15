import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection } from './collections.js';

Meteor.publish('gmail.tokens', function() {
  if (!this.userId) return this.ready();
  return GmailTokensCollection.find({ userId: this.userId });
});

Meteor.publish('gmail.messages', function() {
  if (!this.userId) return this.ready();
  // Only publish messages that have the INBOX label (not archived)
  return GmailMessagesCollection.find({
    userId: this.userId,
    labelIds: { $in: ['INBOX'] }
  }, {
    sort: { gmailDate: -1 }
  });
});

Meteor.publish('emails.inboxZeroThreads', function() {
  if (!this.userId) return this.ready();
  // Publish all messages for InboxZero with complete thread context
  // The client will handle the thread grouping logic
  return GmailMessagesCollection.find({ userId: this.userId }, {
    sort: { gmailDate: -1 }
  });
});

Meteor.publish('email.actionLogs', function() {
  if (!this.userId) return this.ready();
  return EmailActionLogsCollection.find({ userId: this.userId });
});
