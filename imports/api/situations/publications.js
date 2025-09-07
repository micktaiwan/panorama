import { Meteor } from 'meteor/meteor';
import { SituationsCollection } from './collections';

Meteor.publish('situations.all', function publishSituations() {
  return SituationsCollection.find({}, { fields: { title: 1, description: 1, createdAt: 1, updatedAt: 1 } });
});


