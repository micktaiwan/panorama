import { Meteor } from 'meteor/meteor';

/**
 * Get the userId from a Meteor method invocation context.
 * Throws if not logged in.
 */
export function requireUserId() {
  const userId = Meteor.userId();
  if (!userId) throw new Meteor.Error('not-authorized', 'You must be logged in');
  return userId;
}

/**
 * Verify that a document belongs to the current user.
 * Returns the document or throws.
 */
export async function requireOwnership(collection, docId) {
  const userId = requireUserId();
  const doc = await collection.findOneAsync(docId);
  if (!doc) throw new Meteor.Error('not-found', 'Document not found');
  if (doc.userId !== userId) throw new Meteor.Error('not-authorized', 'Access denied');
  return doc;
}
