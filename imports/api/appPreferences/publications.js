import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from './collections';

Meteor.publish('appPreferences', function () {
  if (!this.userId) return this.ready();
  return AppPreferencesCollection.find({ userId: this.userId }, { limit: 1 });
});


