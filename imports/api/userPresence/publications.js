import { Meteor } from 'meteor/meteor';
import { UserPresenceCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

// Publish presence docs for the current user + network
// (users who share at least one project via memberIds)
Meteor.publish('userPresence.network', function publishPresenceNetwork() {
  if (!this.userId) return this.ready();

  this.autorun(async () => {
    const projects = await ProjectsCollection.find(
      { memberIds: this.userId },
      { fields: { memberIds: 1 } }
    ).fetchAsync();

    // Include self + network members
    const networkIds = new Set([this.userId]);
    for (const p of projects) {
      for (const id of (p.memberIds || [])) {
        networkIds.add(id);
      }
    }

    return UserPresenceCollection.find({ userId: { $in: [...networkIds] } });
  });
});

// Publish minimal user info for self + network members (for tooltips)
Meteor.publish('users.network', function publishUsersNetwork() {
  if (!this.userId) return this.ready();

  this.autorun(async () => {
    const projects = await ProjectsCollection.find(
      { memberIds: this.userId },
      { fields: { memberIds: 1 } }
    ).fetchAsync();

    // Include self + network members
    const networkIds = new Set([this.userId]);
    for (const p of projects) {
      for (const id of (p.memberIds || [])) {
        networkIds.add(id);
      }
    }

    return Meteor.users.find(
      { _id: { $in: [...networkIds] } },
      { fields: { emails: 1, username: 1, profile: 1 } }
    );
  });
});
