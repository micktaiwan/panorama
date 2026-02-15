import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const ClaudeProjectsCollection = new Mongo.Collection('claudeProjects', driverOptions);

if (Meteor.isServer) {
  ClaudeProjectsCollection.rawCollection().createIndex({ updatedAt: -1 });
}
