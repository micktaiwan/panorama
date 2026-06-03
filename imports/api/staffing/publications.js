import { Meteor } from 'meteor/meteor';
import { StaffingCollection } from './collections';

Meteor.publish('staffing.all', function () {
  if (!this.userId) return this.ready();
  return StaffingCollection.find({ userId: this.userId }, {
    fields: {
      opportunityId: 1,
      personId: 1,
      role: 1,
      source: 1,
      confidence: 1,
      note: 1,
      lastSeenAt: 1,
      createdAt: 1,
      updatedAt: 1
    }
  });
});
