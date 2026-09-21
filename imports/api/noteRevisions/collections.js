import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

// Append-only history of note bodies. One document per write that changed the
// content, holding the body as it was BEFORE that write. Nothing is ever
// overwritten here, and nothing is ever pruned automatically: the only way to
// remove revisions is the explicit noteRevisions.purge method.
export const NoteRevisionsCollection = new Mongo.Collection('noteRevisions');

if (Meteor.isServer) {
  NoteRevisionsCollection.rawCollection().createIndex({ noteId: 1, createdAt: -1 }).catch(() => {});
  // Ownership stamps: used to list the revisions of notes that no longer exist
  NoteRevisionsCollection.rawCollection().createIndex({ noteUserId: 1 }).catch(() => {});
  NoteRevisionsCollection.rawCollection().createIndex({ noteProjectId: 1 }, { sparse: true }).catch(() => {});
}
