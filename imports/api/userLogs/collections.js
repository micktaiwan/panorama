import { Mongo } from 'meteor/mongo';

// Simple journal entries for the UserLog (Board Journal)
// Schema (flexible): { content: string, createdAt: Date }
export const UserLogsCollection = new Mongo.Collection('userLogs');


