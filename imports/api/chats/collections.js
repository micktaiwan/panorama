import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

// Stores individual chat messages, not threads. Used to keep history across reloads.
// Schema (flexible): { role: 'user'|'assistant', content: string, citations?: [], createdAt: Date }
export const ChatsCollection = new Mongo.Collection('chats', driverOptions);
