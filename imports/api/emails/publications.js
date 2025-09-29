import { Meteor } from 'meteor/meteor';
import { GmailTokensCollection, GmailMessagesCollection } from './collections.js';

Meteor.publish('gmail.tokens', function() {
  return GmailTokensCollection.find({});
});

Meteor.publish('gmail.messages', function() {
  return GmailMessagesCollection.find({});
});
