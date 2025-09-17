import { Meteor } from 'meteor/meteor';
import { CalendarEventsCollection } from './collections';

Meteor.publish('calendar.events.upcoming', function publishCalendarUpcoming() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const horizon = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000);
  return CalendarEventsCollection.find({
    $and: [
      { start: { $lt: horizon } },
      { end: { $gt: startOfDay } }
    ]
  }, { sort: { start: 1 }, limit: 500 });
});
