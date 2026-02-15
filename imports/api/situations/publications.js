import { Meteor } from 'meteor/meteor';
import { SituationsCollection } from './collections';

Meteor.publish('situations.all', function publishSituations() {
  if (!this.userId) return this.ready();
  return SituationsCollection.find({ userId: this.userId }, { fields: { title: 1, description: 1, createdAt: 1, updatedAt: 1 } });
});


