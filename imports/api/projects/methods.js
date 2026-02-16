import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from './collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { FilesCollection } from '/imports/api/files/collections';
import { ensureLoggedIn, ensureOwner, ensureProjectAccess } from '/imports/api/_shared/auth';

// Normalize short text fields
const sanitizeProjectDoc = (input) => {
  const out = { ...input };
  if (typeof out.name === 'string') out.name = out.name.trim();
  if (typeof out.status === 'string') out.status = out.status.trim();
  if (typeof out.description === 'string') out.description = out.description.trim();
  if (typeof out.isFavorite !== 'undefined') out.isFavorite = Boolean(out.isFavorite);
  if (typeof out.favoriteRank !== 'undefined') {
    const n = Number(out.favoriteRank);
    out.favoriteRank = Number.isFinite(n) ? n : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'targetDate')) {
    if (!out.targetDate) {
      out.targetDate = null;
    } else if (out.targetDate instanceof Date) {
      out.targetDate = new Date(out.targetDate);
      if (Number.isNaN(out.targetDate.getTime())) out.targetDate = null;
    } else {
      const d = new Date(out.targetDate);
      out.targetDate = Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return out;
};

Meteor.methods({
  async 'projects.insert'(doc) {
    check(doc, Object);
    ensureLoggedIn(this.userId);
    if (doc.name !== undefined) check(doc.name, String);
    if (doc.status !== undefined) check(doc.status, String);
    const sanitized = sanitizeProjectDoc(doc);
    const _id = await ProjectsCollection.insertAsync({ ...sanitized, userId: this.userId, memberIds: [this.userId], createdAt: new Date(), updatedAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'project', id: _id, text: `${sanitized.name || ''} ${sanitized.description || ''}`.trim(), projectId: _id, userId: this.userId });
    } catch (e) {
      console.error('[search][projects.insert] upsert failed', e);
      throw e instanceof Meteor.Error ? e : new Meteor.Error('vectorization-failed', 'Search indexing failed, but your project was saved.', { insertedId: _id });
    }
    return _id;
  },
  async 'projects.update'(projectId, modifier) {
    check(projectId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    await ensureProjectAccess(projectId, this.userId);
    const sanitized = sanitizeProjectDoc(modifier);
    if (Object.prototype.hasOwnProperty.call(modifier, 'panoramaStatus')) {
      const allowed = new Set(['red','orange','green', null, '']);
      const v = modifier.panoramaStatus;
      if (!allowed.has(v)) throw new Meteor.Error('invalid-panorama-status', 'panoramaStatus must be red|orange|green|null');
      sanitized.panoramaStatus = v || null;
    }
    const res = await ProjectsCollection.updateAsync(projectId, { $set: { ...sanitized, updatedAt: new Date() } });
    try {
      const next = await ProjectsCollection.findOneAsync(projectId, { fields: { name: 1, description: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'project', id: projectId, text: `${next?.name || ''} ${next?.description || ''}`.trim(), projectId, userId: this.userId });
    } catch (e) {
      console.error('[search][projects.update] upsert failed', e);
      throw e instanceof Meteor.Error ? e : new Meteor.Error('vectorization-failed', 'Search indexing failed, but your change was saved.');
    }
    return res;
  },
  async 'projects.remove'(projectId) {
    check(projectId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(ProjectsCollection, projectId, this.userId);
    // Remove all tasks for this project (not scoped to userId — shared project may have docs from other members)
    await TasksCollection.removeAsync({ projectId });
    // Remove notes directly attached to the project
    await NotesCollection.removeAsync({ projectId });
    // Remove note sessions and their lines
    const sessions = await NoteSessionsCollection.find({ projectId }).fetchAsync();
    const sessionIds = sessions.map(s => s._id);
    if (sessionIds.length > 0) {
      await NoteLinesCollection.removeAsync({ sessionId: { $in: sessionIds } });
      await NoteSessionsCollection.removeAsync({ _id: { $in: sessionIds } });
    }
    // Remove links for this project
    await LinksCollection.removeAsync({ projectId });
    // Remove files for this project (including physical files on disk/remote)
    const fileDocs = await FilesCollection.find({ projectId }).fetchAsync();
    for (const f of fileDocs) {
      if (f.storedFileName) {
        try {
          const { isRemoteFileStorage, remoteDeleteFile } = await import('/imports/api/files/remoteFileClient');
          if (isRemoteFileStorage()) {
            await remoteDeleteFile(f.storedFileName);
          } else {
            const { getStorageDir } = await import('/imports/api/files/methods');
            const fs = await import('fs');
            const path = await import('path');
            const storageDir = await getStorageDir();
            const p = path.join(storageDir, f.storedFileName);
            if (fs.existsSync(p)) await fs.promises.unlink(p);
          }
        } catch (e) {
          console.error('[projects.remove] file unlink failed', e);
        }
      }
    }
    await FilesCollection.removeAsync({ projectId });
    // Finally remove the project
    const res = await ProjectsCollection.removeAsync(projectId);
    try { const { deleteByProjectId, deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteByProjectId(projectId); await deleteDoc('project', projectId); } catch (e) { console.error('[search][projects.remove] delete failed', e); }
    return res;
  },
  async 'projects.addMember'(projectId, email) {
    check(projectId, String);
    check(email, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(ProjectsCollection, projectId, this.userId);
    const user = await Meteor.users.findOneAsync({ 'emails.address': email }, { fields: { _id: 1 } });
    if (!user) throw new Meteor.Error('user-not-found', 'No user with this email');
    await ProjectsCollection.updateAsync(projectId, { $addToSet: { memberIds: user._id } });
    return user._id;
  },
  async 'projects.removeMember'(projectId, memberId) {
    check(projectId, String);
    check(memberId, String);
    ensureLoggedIn(this.userId);
    const project = await ensureOwner(ProjectsCollection, projectId, this.userId);
    if (project.userId === memberId) throw new Meteor.Error('cannot-remove-owner', 'Cannot remove the project owner');
    await ProjectsCollection.updateAsync(projectId, { $pull: { memberIds: memberId } });
    return true;
  }
});


