import { Mongo } from 'meteor/mongo';

// Shape Up opportunities / projects for the CTO staffing dashboard.
// Distinct from the personal ProjectsCollection: these are the columns of the
// staffing matrix (what the eng org works on per cycle), not personal projects.
export const OpportunitiesCollection = new Mongo.Collection('opportunities');

export const OPPORTUNITY_STATUSES = ['idea', 'in_progress', 'cooldown', 'shipped', 'paused'];
