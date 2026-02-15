import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const ClaudeSessionsCollection = new Mongo.Collection('claudeSessions', driverOptions);

if (Meteor.isServer) {
  ClaudeSessionsCollection.rawCollection().createIndex({ projectId: 1, createdAt: 1 });
}
