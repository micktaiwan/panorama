import { Mongo } from 'meteor/mongo';

// Individual commits ingested from GitHub (per owning userId).
export const CommitsCollection = new Mongo.Collection('commits');

// Per-branch classification cache: branch -> opportunity. Legacy of the branch-based
// model — still read by the UI (scope -> opportunity mapping) and commits.byOpportunity.
export const BranchClassificationsCollection = new Mongo.Collection('branchClassifications');
