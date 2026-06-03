import { Meteor } from 'meteor/meteor';
import { OpportunitiesCollection } from './collections';

Meteor.publish('opportunities.all', function () {
  if (!this.userId) return this.ready();
  return OpportunitiesCollection.find({ userId: this.userId }, {
    fields: {
      name: 1,
      status: 1,
      cycle: 1,
      notionUrl: 1,
      keywords: 1,
      order: 1,
      createdAt: 1,
      updatedAt: 1
    }
  });
});
