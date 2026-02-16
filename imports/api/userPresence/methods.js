import { Meteor } from 'meteor/meteor';
import { UserPresenceCollection } from './collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'userPresence.setAway'() {
    ensureLoggedIn(this.userId);
    await UserPresenceCollection.updateAsync(
      { userId: this.userId },
      { $set: { status: 'away', updatedAt: new Date() } }
    );
  },

  async 'userPresence.setActive'() {
    ensureLoggedIn(this.userId);
    await UserPresenceCollection.updateAsync(
      { userId: this.userId },
      { $set: { status: 'online', lastSeenAt: new Date(), updatedAt: new Date() } }
    );
  },
});
