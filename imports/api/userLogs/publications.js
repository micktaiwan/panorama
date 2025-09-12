import { Meteor } from 'meteor/meteor';
import { UserLogsCollection } from './collections';

// Publish recent journal entries (board journal)
Meteor.publish('userLogs.recent', function (limit = 200) {
  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 200;
  return UserLogsCollection.find({}, { sort: { createdAt: -1 }, limit: lim });
});


