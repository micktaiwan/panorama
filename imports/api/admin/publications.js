import { Meteor } from 'meteor/meteor';

// Auto-publish isAdmin field for the logged-in user
Meteor.publish(null, function () {
  if (!this.userId) return this.ready();
  return Meteor.users.find({ _id: this.userId }, { fields: { isAdmin: 1 } });
});
