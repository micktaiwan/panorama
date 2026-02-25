import { Meteor } from 'meteor/meteor';
import { RefreshProgressCollection } from './collections';
import { ensureLoggedIn } from '../_shared/auth';

/**
 * Update progress for a specific step (server-side helper).
 * Called from email methods to push granular progress to the client via reactivity.
 */
export async function updateProgress(userId, stepKey, update) {
  await RefreshProgressCollection.upsertAsync(
    { userId, stepKey },
    { $set: { userId, stepKey, ...update, updatedAt: new Date() } }
  );
}

/**
 * Clear all progress documents for a user.
 */
export async function clearProgress(userId) {
  await RefreshProgressCollection.removeAsync({ userId });
}

Meteor.methods({
  async 'refreshProgress.clear'() {
    ensureLoggedIn(this.userId);
    await clearProgress(this.userId);
  }
});
