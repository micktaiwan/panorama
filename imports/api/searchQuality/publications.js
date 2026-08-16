import { Meteor } from 'meteor/meteor';
import { SearchQualityRunsCollection } from './collections';

Meteor.publish('searchQualityRuns.recent', function publishSearchQualityRuns(limit) {
  if (!this.userId) return this.ready();
  const max = Math.max(1, Math.min(100, Number(limit) || 20));
  return SearchQualityRunsCollection.find(
    { userId: this.userId },
    { sort: { startedAt: -1 }, limit: max }
  );
});
