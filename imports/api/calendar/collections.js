import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const CalendarEventsCollection = new Mongo.Collection('calendarEvents');

if (Meteor.isServer) {
  // Support upcoming-window queries and sorting by start
  CalendarEventsCollection.rawCollection().createIndex({ start: 1, end: 1 });
  // Upsert by uid during ICS sync
  CalendarEventsCollection.rawCollection().createIndex({ uid: 1 });
}


