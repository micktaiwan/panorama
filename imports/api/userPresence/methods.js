import { Meteor } from 'meteor/meteor';
import { UserPresenceCollection } from './collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  // Both presence methods run on every bit of mouse/keyboard activity. Without
  // unblock(), a presence write stuck on Mongo (or on its change-stream write
  // fence) holds the whole DDP session queue, and every later call of the window
  // waits behind it (the Panorama page then loads forever).
  async 'userPresence.setAway'() {
    this.unblock();
    ensureLoggedIn(this.userId);
    await UserPresenceCollection.updateAsync(
      { userId: this.userId },
      { $set: { status: 'away', updatedAt: new Date() } }
    );
  },

  async 'userPresence.setActive'() {
    this.unblock();
    ensureLoggedIn(this.userId);
    await UserPresenceCollection.updateAsync(
      { userId: this.userId },
      { $set: { status: 'online', lastSeenAt: new Date(), updatedAt: new Date() } }
    );
  },
});
