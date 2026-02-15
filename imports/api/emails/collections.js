import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const GmailTokensCollection = new Mongo.Collection('gmailTokens', driverOptions);
export const GmailMessagesCollection = new Mongo.Collection('gmailMessages', driverOptions);
export const EmailActionLogsCollection = new Mongo.Collection('emailActionLogs', driverOptions);
