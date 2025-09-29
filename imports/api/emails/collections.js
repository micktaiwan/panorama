import { Mongo } from 'meteor/mongo';

export const GmailTokensCollection = new Mongo.Collection('gmailTokens');
export const GmailMessagesCollection = new Mongo.Collection('gmailMessages');
