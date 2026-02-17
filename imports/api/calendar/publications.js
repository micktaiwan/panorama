import { Meteor } from 'meteor/meteor';
import { CalendarEventsCollection } from './collections';

Meteor.publish('calendar.events.upcoming', function publishCalendarUpcoming() {
  if (!this.userId) return this.ready();
  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days to match algorithm horizon
  return CalendarEventsCollection.find({
    userId: this.userId,
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
