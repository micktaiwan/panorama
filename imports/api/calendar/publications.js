import { Meteor } from 'meteor/meteor';
import { CalendarEventsCollection } from './collections';

Meteor.publish('calendar.events.upcoming', function publishCalendarUpcoming() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days to match algorithm horizon
  return CalendarEventsCollection.find({
    $and: [
      { start: { $lt: horizon } },
      { end: { $gt: now } }, // Exclude past events
      // Exclude all-day events (they don't block work time)
      { $or: [{ allDay: { $exists: false } }, { allDay: false }] },
      // Exclude transparent events (working locations, etc.)
      { $or: [{ transparency: { $exists: false } }, { transparency: { $ne: 'transparent' } }] }
    ]
  }, { sort: { start: 1 }, limit: 500 });
});
