import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const TasksCollection = new Mongo.Collection('tasks');

// Indexes for provenance lookups (userLog linking)
if (Meteor.isServer) {
  // Align with other collections: use rawCollection().createIndex
  TasksCollection.rawCollection().createIndex({ 'source.kind': 1, 'source.logEntryIds': 1 });
}
