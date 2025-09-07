import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from './collections';

Meteor.publish('appPreferences', function () {
  return AppPreferencesCollection.find({}, { limit: 1 });
});


