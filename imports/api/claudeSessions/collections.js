import { Mongo } from 'meteor/mongo';

export const ClaudeSessionsCollection = new Mongo.Collection('claudeSessions');

if (Meteor.isServer) {
  ClaudeSessionsCollection.rawCollection().createIndex({ projectId: 1, createdAt: 1 });
}
