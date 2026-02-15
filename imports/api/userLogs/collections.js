import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

// Simple journal entries for the UserLog (Board Journal)
// Schema (flexible): { content: string, createdAt: Date }
export const UserLogsCollection = new Mongo.Collection('userLogs', driverOptions);


