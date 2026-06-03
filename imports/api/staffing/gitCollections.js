import { Mongo } from 'meteor/mongo';

// Individual commits ingested from GitHub (per owning userId).
export const CommitsCollection = new Mongo.Collection('commits');

// Per-branch classification cache: branch -> opportunity (avoids re-calling the LLM).
export const BranchClassificationsCollection = new Mongo.Collection('branchClassifications');

// Candidate new opportunities proposed from unclassified git activity.
// These are proposals only — nothing is created until the user accepts.
export const OpportunitySuggestionsCollection = new Mongo.Collection('opportunitySuggestions');
