import { Mongo } from 'meteor/mongo';

// Join between a person and an opportunity: who works on what.
// Mirrors the spec's project_staffing so future git-deduction can write rows
// with source='git' + confidence<1 alongside manual rows.
export const StaffingCollection = new Mongo.Collection('staffing');

export const STAFFING_ROLES = ['dev', 'tech_lead', 'pm', 'designer', 'qa'];
export const STAFFING_SOURCES = ['manual', 'notion', 'git'];
