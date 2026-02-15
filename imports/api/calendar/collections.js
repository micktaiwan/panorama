import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const CalendarEventsCollection = new Mongo.Collection('calendarEvents', driverOptions);

if (Meteor.isServer) {
  // Support upcoming-window queries and sorting by start
  CalendarEventsCollection.rawCollection().createIndex({ start: 1, end: 1 });
  // Upsert by uid during ICS sync
  CalendarEventsCollection.rawCollection().createIndex({ uid: 1 });
}


