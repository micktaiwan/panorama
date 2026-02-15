import { Meteor } from 'meteor/meteor';

/**
 * Throw 'not-authorized' if userId is falsy.
 * Use at the top of Meteor methods that require a logged-in user.
 */
export const ensureLoggedIn = (userId) => {
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'You must be logged in');
  }
};

/**
 * Verify that `userId` owns the document `docId` in `collection`.
 * Returns the document if found; throws 'not-found' otherwise.
 * This prevents information leakage (user can't tell if doc exists for another user).
 */
export const ensureOwner = async (collection, docId, userId) => {
  const doc = await collection.findOneAsync({ _id: docId, userId });
  if (!doc) {
    throw new Meteor.Error('not-found', 'Document not found');
  }
  return doc;
};

