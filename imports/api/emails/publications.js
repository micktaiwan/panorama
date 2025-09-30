import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection } from './collections.js';

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
