import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from '/imports/api/projects/collections';

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

/**
 * Verify that `userId` is a member of the project `projectId`.
 * Returns the project if found; throws 'not-found' otherwise.
 */
export const ensureProjectAccess = async (projectId, userId) => {
  const project = await ProjectsCollection.findOneAsync({
    _id: projectId, memberIds: userId,
  });
  if (!project) throw new Meteor.Error('not-found', 'Project not found');
  return project;
};

/**
 * Throw 'not-authorized' if user is not an admin.
 * Use at the top of Meteor methods that require admin access.
 */
export const ensureAdmin = async (userId) => {
  ensureLoggedIn(userId);
  const user = await Meteor.users.findOneAsync(userId, { fields: { isAdmin: 1 } });
  if (!user?.isAdmin) {
    throw new Meteor.Error('not-authorized', 'Admin access required');
  }
};

