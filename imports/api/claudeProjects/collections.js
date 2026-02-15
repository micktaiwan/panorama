import { Mongo } from 'meteor/mongo';

export const ClaudeProjectsCollection = new Mongo.Collection('claudeProjects');

if (Meteor.isServer) {
  ClaudeProjectsCollection.rawCollection().createIndex({ updatedAt: -1 });
}
