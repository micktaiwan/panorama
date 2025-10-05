import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection, EmailActionLogsCollection } from './collections.js';

Meteor.publish('gmail.tokens', function() {
  return GmailTokensCollection.find({});
});

Meteor.publish('gmail.messages', function() {
  // Only publish messages that have the INBOX label (not archived)
  return GmailMessagesCollection.find({
    labelIds: { $in: ['INBOX'] }
  }, {
    sort: { gmailDate: -1 }
  });
});

Meteor.publish('emails.inboxZeroThreads', function() {
  // Publish all messages for InboxZero with complete thread context
  // The client will handle the thread grouping logic
  return GmailMessagesCollection.find({}, {
    sort: { gmailDate: -1 }
  });
});

Meteor.publish('email.actionLogs', function() {
  return EmailActionLogsCollection.find({});
});
