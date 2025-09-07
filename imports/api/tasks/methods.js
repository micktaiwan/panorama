import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { TasksCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

// Normalize short text fields
const sanitizeTaskDoc = (input) => {
  const out = { ...input };
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (typeof out.status === 'string') out.status = out.status.trim();
  if (typeof out.priorityRank !== 'undefined') {
    const n = Number(out.priorityRank);
    out.priorityRank = Number.isFinite(n) ? n : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'isUrgent')) {
    out.isUrgent = Boolean(out.isUrgent);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'isImportant')) {
    out.isImportant = Boolean(out.isImportant);
  }
  return out;
};

Meteor.methods({
  async 'tasks.insert'(doc) {
    check(doc, Object);
    const now = new Date();
    const sanitized = sanitizeTaskDoc(doc);
    const _id = await TasksCollection.insertAsync({
      status: doc.status || 'todo',
      statusChangedAt: now,
      ...sanitized,
      isUrgent: Boolean(sanitized.isUrgent),
      isImportant: Boolean(sanitized.isImportant),
      createdAt: now,
      updatedAt: now
    });
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'task', id: _id, text: sanitized.title || '', projectId: sanitized.projectId || null });
    } catch (e) { console.error('[search][tasks.insert] upsert failed', e); }
    return _id;
  },
  async 'tasks.update'(taskId, modifier) {
    check(taskId, String);
    check(modifier, Object);
    const task = await TasksCollection.findOneAsync(taskId);
    const set = { ...sanitizeTaskDoc(modifier), updatedAt: new Date() };
    const unset = {};
    if (Object.prototype.hasOwnProperty.call(modifier, 'status')) {
      const nextStatus = modifier.status;
      if (!task || task.status !== nextStatus) {
        set.statusChangedAt = new Date();
        if (task && task.doneAt) {
          unset.doneAt = 1; // clean legacy field if present
        }
      }
    }
    const modifierDoc = Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set };
    const res = await TasksCollection.updateAsync(taskId, modifierDoc);
    if (task && task.projectId) {
      await ProjectsCollection.updateAsync(task.projectId, { $set: { updatedAt: new Date() } });
    }
    try {
      const next = await TasksCollection.findOneAsync(taskId, { fields: { title: 1, projectId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'task', id: taskId, text: (next && next.title) || '', projectId: next && next.projectId });
    } catch (e) { console.error('[search][tasks.update] upsert failed', e); }
    return res;
  },
  // Removed legacy setDone/unsetDone methods
  async 'tasks.remove'(taskId) {
    check(taskId, String);
    const task = await TasksCollection.findOneAsync(taskId);
    const res = await TasksCollection.removeAsync(taskId);
    try { const { deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteDoc('task', taskId); } catch (e) { console.error('[search][tasks.remove] delete failed', e); }
    if (task && task.projectId) {
      await ProjectsCollection.updateAsync(task.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  }
});


