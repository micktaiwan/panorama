import { Meteor } from 'meteor/meteor';
import { UserPreferencesCollection } from './collections';

Meteor.publish('userPreferences', function publishUserPreferences() {
  if (!this.userId) return this.ready();
  return UserPreferencesCollection.find({ userId: this.userId });
});
