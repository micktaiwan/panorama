import { Mongo } from 'meteor/mongo';

// Stores individual chat messages, not threads. Used to keep history across reloads.
// Schema (flexible): { role: 'user'|'assistant', content: string, citations?: [], createdAt: Date }
export const ChatsCollection = new Mongo.Collection('chats');
