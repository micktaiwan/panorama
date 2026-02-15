import { Mongo } from 'meteor/mongo';

export const UserPreferencesCollection = new Mongo.Collection('userPreferences');
