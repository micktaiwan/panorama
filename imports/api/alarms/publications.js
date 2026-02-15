import { Meteor } from 'meteor/meteor';
import { AlarmsCollection } from './collections';

Meteor.publish('alarms.mine', function publishAlarms() {
  if (!this.userId) return this.ready();
  return AlarmsCollection.find({ userId: this.userId });
});
