import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

export const NotesCollection = new Mongo.Collection('notes');

if (Meteor.isServer) {
  NotesCollection.rawCollection().createIndex({ claudeProjectId: 1 }, { sparse: true });
}


