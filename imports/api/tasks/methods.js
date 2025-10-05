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
    // If a project is provided, shift existing open tasks down and insert new task at rank 0
    if (sanitized.projectId) {
      const projectId = String(sanitized.projectId);
      const openSelector = {
        projectId,
        $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ]
      };
      // Shift all open tasks down by 1 in a single multi-update, then insert at rank 0
      await TasksCollection.updateAsync(openSelector, { $inc: { priorityRank: 1 } }, { multi: true });
      sanitized.priorityRank = 0;
    }
    // Duplicate guard for userLog provenance
    if (doc?.source && doc.source.kind === 'userLog' && Array.isArray(doc.source.logEntryIds) && doc.source.logEntryIds.length > 0) {
      const logIds = doc.source.logEntryIds.map(String);
      const existing = await TasksCollection.findOneAsync({ 'source.kind': 'userLog', 'source.logEntryIds': { $in: logIds } }, { fields: { _id: 1 } });
      if (existing) {
        throw new Meteor.Error('duplicate-task', 'A task already exists for at least one of these journal entries');
      }
    }
    const _id = await TasksCollection.insertAsync({
      status: doc.status || 'todo',
      statusChangedAt: now,
      ...sanitized,
      isUrgent: Boolean(sanitized.isUrgent),
      isImportant: Boolean(sanitized.isImportant),
      // Provenance link (optional): { kind: 'userLog', logEntryIds: [], createdAt, windowHours }
      source: (doc?.source && doc.source.kind === 'userLog' && Array.isArray(doc.source.logEntryIds))
        ? { kind: 'userLog', logEntryIds: doc.source.logEntryIds.slice(0, 20), createdAt: now, windowHours: Number(doc.source.windowHours) || undefined }
        : undefined,
      createdAt: now,
      updatedAt: now
    });
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      const text = `${sanitized.title || ''} ${sanitized.notes || ''}`.trim();
      await upsertDoc({ kind: 'task', id: _id, text, projectId: sanitized.projectId || null });
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
    // Only re-index in vector store when searchable fields change
    const shouldReindex = Object.hasOwn(modifier, 'title') || Object.hasOwn(modifier, 'notes') || Object.hasOwn(modifier, 'projectId');
    if (shouldReindex) {
      try {
        const next = await TasksCollection.findOneAsync(taskId, { fields: { title: 1, notes: 1, projectId: 1 } });
        const text = `${next?.title || ''} ${next?.notes || ''}`.trim();
        const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
        await upsertDoc({ kind: 'task', id: taskId, text, projectId: next && next.projectId });
      } catch (e) { console.error('[search][tasks.update] upsert failed', e); }
    }
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
  },
  async 'tasks.promoteToTop'(taskId) {
    check(taskId, String);
    const task = await TasksCollection.findOneAsync(taskId);
    
    if (!task) {
      throw new Meteor.Error('task-not-found', 'Task not found');
    }
    
    // Get all open tasks sorted by current priorityRank
    const globalOpenSelector = {
      $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ]
    };
    
    const allOpenTasks = await TasksCollection.find(globalOpenSelector).fetchAsync();
    
    // Sort using the original logic: deadline -> status -> priorityRank -> createdAt
    const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
    
    allOpenTasks.sort((a, b) => {
      const ad = toTime(a.deadline);
      const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd; // earlier deadlines first
      
      const as = statusRank(a.status || 'todo');
      const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs; // in_progress before others
      
      const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
      const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br; // lower priorityRank first
      
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc; // earlier created first
    });
    
    // Set target task to rank 0 first
    await TasksCollection.updateAsync(taskId, { 
      $set: { priorityRank: 0, updatedAt: new Date() } 
    });
    
    // Now sort again with the updated rank
    allOpenTasks.forEach(t => {
      if (t._id === taskId) {
        t.priorityRank = 0; // Update the local copy
      }
    });
    
    // Re-sort with the new rank
    allOpenTasks.sort((a, b) => {
      const ad = toTime(a.deadline);
      const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd;
      
      const as = statusRank(a.status || 'todo');
      const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs;
      
      const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
      const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc;
    });
    
    // Recalculate ranks based on the final sorted order
    const updates = allOpenTasks.map((t, index) => 
      TasksCollection.updateAsync(t._id, { 
        $set: { priorityRank: index, updatedAt: new Date() } 
      })
    );
    
    // Execute all updates
    await Promise.all(updates);
    
    // Update project timestamp if task belongs to a project
    if (task.projectId) {
      await ProjectsCollection.updateAsync(task.projectId, { $set: { updatedAt: new Date() } });
    }
    
    return true;
  }
  
});


