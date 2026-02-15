import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const ClaudeMessagesCollection = new Mongo.Collection('claudeMessages', driverOptions);

if (Meteor.isServer) {
  ClaudeMessagesCollection.rawCollection().createIndex({ sessionId: 1, createdAt: 1 });
}
