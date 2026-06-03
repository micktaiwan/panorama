import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { StaffingCollection, STAFFING_ROLES } from './collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const cleanRole = (r) => (STAFFING_ROLES.includes(r) ? r : 'dev');

Meteor.methods({
  // Toggle a person's manual assignment on an opportunity (the matrix cell click).
  // Returns true if now assigned, false if removed.
  async 'staffing.toggle'(opportunityId, personId, role) {
    check(opportunityId, String);
    check(personId, String);
    ensureLoggedIn(this.userId);
    const existing = await StaffingCollection.findOneAsync({ userId: this.userId, opportunityId, personId });
    if (existing) {
      await StaffingCollection.removeAsync({ _id: existing._id });
      return false;
    }
    const now = new Date();
    await StaffingCollection.insertAsync({
      opportunityId,
      personId,
      role: cleanRole(role),
      source: 'manual',
      confidence: 1,
      note: '',
      userId: this.userId,
      createdAt: now,
      updatedAt: now
    });
    return true;
  },

  async 'staffing.setRole'(id, role) {
    check(id, String);
    check(role, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(StaffingCollection, id, this.userId);
    await StaffingCollection.updateAsync({ _id: id }, { $set: { role: cleanRole(role), updatedAt: new Date() } });
  },

  async 'staffing.remove'(id) {
    check(id, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(StaffingCollection, id, this.userId);
    await StaffingCollection.removeAsync({ _id: id });
  }
});
