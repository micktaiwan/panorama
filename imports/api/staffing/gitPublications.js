import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { CommitsCollection, BranchClassificationsCollection, OpportunitySuggestionsCollection } from './gitCollections';

Meteor.publish('commits.recent', function (limit = 500) {
  if (!this.userId) return this.ready();
  const lim = Math.min(Number(limit) || 500, 2000);
  return CommitsCollection.find(
    { userId: this.userId },
    { sort: { committedAt: -1 }, limit: lim }
  );
});

Meteor.publish('branchClassifications.all', function () {
  if (!this.userId) return this.ready();
  return BranchClassificationsCollection.find({ userId: this.userId });
});

// Commits attached to one opportunity: either a manual per-commit override
// (commit.opportunityId === id) OR no override but their scope is classified to it.
Meteor.publish('commits.byOpportunity', async function (opportunityId) {
  if (!this.userId) return this.ready();
  check(opportunityId, String);
  const cls = await BranchClassificationsCollection.find(
    { userId: this.userId, opportunityId },
    { fields: { branch: 1 } }
  ).fetchAsync();
  const scopes = cls.map(c => c.branch);
  return CommitsCollection.find(
    {
      userId: this.userId,
      $or: [
        { opportunityId },
        { opportunityId: { $exists: false }, scope: { $in: scopes } }
      ]
    },
    { sort: { committedAt: -1 }, limit: 500 }
  );
});

Meteor.publish('opportunitySuggestions.all', function () {
  if (!this.userId) return this.ready();
  return OpportunitySuggestionsCollection.find({ userId: this.userId }, { sort: { confidence: -1 } });
});
