import { Mongo } from 'meteor/mongo';

// One document per Search Quality Test run (started from the UI or from MCP).
// Holds the compacted outcome: metrics, failure patterns, recommendations and
// the failing documents — enough to compare runs before/after a fix.
export const SearchQualityRunsCollection = new Mongo.Collection('searchQualityRuns');
