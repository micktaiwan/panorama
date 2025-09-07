import { Meteor } from 'meteor/meteor';
import { AlarmsCollection } from './collections';

Meteor.publish('alarms.mine', function publishAlarms() {
  return AlarmsCollection.find({});
});
