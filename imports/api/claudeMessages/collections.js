import { Mongo } from 'meteor/mongo';

export const ClaudeMessagesCollection = new Mongo.Collection('claudeMessages');

if (Meteor.isServer) {
  ClaudeMessagesCollection.rawCollection().createIndex({ sessionId: 1, createdAt: 1 });
}
