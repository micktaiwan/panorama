import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Files, FilesCollection } from './collections';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth.js';

const sanitizeName = (name) => String(name || '').trim();

// --- Server-only: afterUpload hook + methods ---
if (Meteor.isServer) {
  Files.on('afterUpload', function (fileRef) {
    // Apply meta fields from the client (projectId) and initialize counters
    const meta = fileRef.meta || {};
    const updates = {
      userId: fileRef.userId || null,
      projectId: meta.projectId || '__none__',
      name: meta.name || fileRef.name.replace(/\.[^.]+$/, ''),
      originalName: fileRef.name,
      clicksCount: 0,
      lastClickedAt: null,
      updatedAt: new Date(),
    };
    FilesCollection.updateAsync(fileRef._id, { $set: updates });
  });
}

Meteor.methods({
  async 'files.update'(fileId, modifier) {
    check(fileId, String);
    check(modifier, Object);
    await requireOwnership(FilesCollection, fileId);
    const updates = {};
    if (typeof modifier.name === 'string') updates.name = sanitizeName(modifier.name);
    if (typeof modifier.projectId === 'string') updates.projectId = modifier.projectId || '__none__';
    updates.updatedAt = new Date();
    await FilesCollection.updateAsync(fileId, { $set: updates });
    return true;
  },

  async 'files.remove'(fileId) {
    check(fileId, String);
    await requireOwnership(FilesCollection, fileId);
    // removeAsync deletes both the MongoDB doc and the physical file
    await Files.removeAsync({ _id: fileId });
    return true;
  },

  async 'files.registerClick'(fileId) {
    check(fileId, String);
    await requireOwnership(FilesCollection, fileId);
    await FilesCollection.updateAsync(fileId, {
      $set: { lastClickedAt: new Date() },
      $inc: { clicksCount: 1 },
    });
    return true;
  },
});
