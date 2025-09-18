import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from './collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { NotesCollection } from '/imports/api/notes/collections';

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
    if (doc.name !== undefined) check(doc.name, String);
    if (doc.status !== undefined) check(doc.status, String);
    const sanitized = sanitizeProjectDoc(doc);
    const _id = await ProjectsCollection.insertAsync({ ...sanitized, createdAt: new Date(), updatedAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'project', id: _id, text: `${sanitized.name || ''} ${sanitized.description || ''}`.trim(), projectId: _id });
    } catch (e) { console.error('[search][projects.insert] upsert failed', e); }
    return _id;
  },
  async 'projects.update'(projectId, modifier) {
    check(projectId, String);
    check(modifier, Object);
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
      await upsertDoc({ kind: 'project', id: projectId, text: `${next?.name || ''} ${next?.description || ''}`.trim(), projectId });
    } catch (e) { console.error('[search][projects.update] upsert failed', e); }
    return res;
  },
  async 'projects.remove'(projectId) {
    check(projectId, String);
    // Remove tasks
    await TasksCollection.removeAsync({ projectId });
    // Remove notes directly attached to the project (if any model uses this)
    await NotesCollection.removeAsync({ projectId });
    // Remove note sessions and their lines
    const sessions = await NoteSessionsCollection.find({ projectId }).fetchAsync();
    const sessionIds = sessions.map(s => s._id);
    if (sessionIds.length > 0) {
      await NoteLinesCollection.removeAsync({ sessionId: { $in: sessionIds } });
      await NoteSessionsCollection.removeAsync({ _id: { $in: sessionIds } });
    }
    // Finally remove the project
    const res = await ProjectsCollection.removeAsync(projectId);
    try { const { deleteByProjectId, deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteByProjectId(projectId); await deleteDoc('project', projectId); } catch (e) { console.error('[search][projects.remove] delete failed', e); }
    return res;
  }
});


