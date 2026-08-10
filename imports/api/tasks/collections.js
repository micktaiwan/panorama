import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const TasksCollection = new Mongo.Collection('tasks');

// Deleting a task only stamps `deletedAt`: the document stays in place for
// TRASH_RETENTION_DAYS so it can be restored, and so the activity reporting
// still sees it (Mickael deletes tasks instead of marking them done).
// A cron job (imports/api/cron/jobs.js) does the real removal afterwards.
export const TRASH_RETENTION_DAYS = 7;

// Every query that feeds a task list must exclude the trash.
export const NOT_DELETED = { deletedAt: { $exists: false } };

/** Add the not-deleted condition to an existing selector without mutating it. */
export const excludeDeleted = (selector = {}) => ({ ...selector, ...NOT_DELETED });

// Indexes for provenance lookups (userLog linking)
if (Meteor.isServer) {
  // Align with other collections: use rawCollection().createIndex
  TasksCollection.rawCollection().createIndex({ 'source.kind': 1, 'source.logEntryIds': 1 });
  // Trash sweep: the purge cron scans by deletion date only.
  TasksCollection.rawCollection().createIndex({ deletedAt: 1 });
}
