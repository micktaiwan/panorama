import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'users.updateProfile'(fields) {
    check(fields, Object);
    ensureLoggedIn(this.userId);
    const $set = {};
    if (typeof fields.name === 'string') {
      $set['profile.name'] = fields.name.trim() || null;
    }
    if (Object.keys($set).length > 0) {
      await Meteor.users.updateAsync(this.userId, { $set });
    }
    return true;
  },
});
