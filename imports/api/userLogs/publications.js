import { Meteor } from 'meteor/meteor';
import { UserLogsCollection } from './collections';

// Publish recent journal entries (board journal)
Meteor.publish('userLogs.recent', function (limit = 200) {
  if (!this.userId) return this.ready();
  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 200;
  return UserLogsCollection.find({ userId: this.userId }, { sort: { createdAt: -1 }, limit: lim });
});

// Publish entries since a given date (inclusive)
Meteor.publish('userLogs.since', function (sinceDate) {
  if (!this.userId) return this.ready();
  const d = sinceDate instanceof Date ? sinceDate : new Date(sinceDate);
  if (!Number.isFinite(d.getTime())) {
    return this.ready();
  }
  return UserLogsCollection.find({ createdAt: { $gte: d }, userId: this.userId }, { sort: { createdAt: -1 } });
});


