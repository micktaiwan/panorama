import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';

// Compute a simple health score based on overdue/blockers/dormancy and recent activity
const computeHealth = ({ t = {}, n = {}, dormant = false }) => {
  let score = 100;
  const overdue = Number(t.overdue || 0);
  const blocked = Number(t.blocked || 0);
  const notes7d = Number(n.notes7d || 0);
  score -= overdue * 8;
  score -= blocked * 6;
  if (dormant) score -= 20;
  score += Math.min(20, notes7d * 2);
  score = Math.max(0, Math.min(100, score));
  return { score };
};

Meteor.methods({
  async 'panorama.getOverview'(filters = {}) {
    check(filters, Object);
    const periodDays = Number(filters.periodDays) || 14;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const projFields = { fields: { name: 1, tags: 1, updatedAt: 1, panoramaUpdatedAt: 1, targetDate: 1, status: 1, createdAt: 1, panoramaRank: 1, panoramaStatus: 1 } };
    const projects = await ProjectsCollection.find({}, projFields).fetchAsync();
    const projectIds = projects.map(p => p._id);

    // Aggregate per-project task metrics using JS for simplicity first (optimize later)
    const taskFields = { fields: { projectId: 1, status: 1, deadline: 1, updatedAt: 1, title: 1, statusChangedAt: 1, createdAt: 1, priorityRank: 1 } };
    const allTasks = await TasksCollection.find({ projectId: { $in: projectIds } }, taskFields).fetchAsync();
    const now = new Date();
    const soon = new Date(Date.now() + 3 * 864e5);
    const tasksByProject = new Map();
    for (const t of allTasks) {
      const pid = t.projectId || '';
      if (!tasksByProject.has(pid)) tasksByProject.set(pid, { open: 0, overdue: 0, dueSoon: 0, blocked: 0, lastTaskAt: null, next: [] });
      const acc = tasksByProject.get(pid);
      const status = (t.status || 'todo');
      const isClosed = ['done', 'cancelled'].includes(status);
      if (!isClosed) acc.open += 1;
      const dl = t.deadline ? new Date(t.deadline) : null;
      if (!isClosed && dl && dl < now) acc.overdue += 1;
      if (!isClosed && dl && dl >= now && dl <= soon) acc.dueSoon += 1;
      // Blocked flag not modeled yet → placeholder 0; could derive from status or notes later
      const upd = t.updatedAt ? new Date(t.updatedAt) : null;
      const statusChanged = t.statusChangedAt ? new Date(t.statusChangedAt) : null;
      const created = t.createdAt ? new Date(t.createdAt) : null;
      const mostRecent = [upd, statusChanged, created].filter(Boolean).sort((a, b) => b - a)[0];
      if (mostRecent && (!acc.lastTaskAt || mostRecent > acc.lastTaskAt)) {
        acc.lastTaskAt = mostRecent;
      }
      // task heat within period
      const changedAt = t.statusChangedAt || t.updatedAt || t.createdAt || null;
      if (changedAt && new Date(changedAt) >= since) {
        acc.changedInPeriod = (acc.changedInPeriod || 0) + 1;
      }
      if (!isClosed) {
        const title = typeof t.title === 'string' ? t.title.trim() : '';
        if (title) acc.next.push({
          _id: t._id,
          title,
          deadline: t.deadline || null,
          status: t.status || 'todo',
          priorityRank: Number.isFinite(t.priorityRank) ? t.priorityRank : null,
          createdAt: t.createdAt || null
        });
      }
    }
    for (const [, acc] of tasksByProject) {
      const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
      const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
      acc.next.sort((a, b) => {
        const ad = toTime(a.deadline); const bd = toTime(b.deadline);
        if (ad !== bd) return ad - bd;
        const as = statusRank(a.status || 'todo'); const bs = statusRank(b.status || 'todo');
        if (as !== bs) return as - bs;
        const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
        const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ac - bc;
      });
      acc.next = acc.next.slice(0, 5);
    }

    // Notes aggregates (for last activity calculation and heat)
    const noteFields = { fields: { projectId: 1, createdAt: 1, updatedAt: 1 } };
    const notesRecent = await NotesCollection.find({
      projectId: { $in: projectIds },
      $or: [ { createdAt: { $gte: since } }, { updatedAt: { $gte: since } } ]
    }, noteFields).fetchAsync();
    const notesAll = await NotesCollection.find({ projectId: { $in: projectIds } }, noteFields).fetchAsync();
    const notesByProject = new Map();
    const notesLastByProject = new Map();
    for (const n of notesRecent) {
      const pid = n.projectId || '';
      if (!notesByProject.has(pid)) notesByProject.set(pid, { notes7d: 0 });
      const acc = notesByProject.get(pid);
      acc.notes7d += 1;
    }
    for (const n of notesAll) {
      const pid = n.projectId || '';
      const created = n.createdAt ? new Date(n.createdAt) : null;
      const updated = n.updatedAt ? new Date(n.updatedAt) : null;
      const mostRecent = [created, updated].filter(Boolean).sort((a, b) => b - a)[0];
      const prev = notesLastByProject.get(pid) || null;
      if (mostRecent && (!prev || mostRecent > prev)) {
        notesLastByProject.set(pid, mostRecent);
      }
    }
    
    // Add project creation date to lastNoteAt calculation
    for (const p of projects) {
      const pid = p._id;
      const projectCreated = p.createdAt ? new Date(p.createdAt) : null;
      const lastNoteAt = notesLastByProject.get(pid) || null;
      if (projectCreated && (!lastNoteAt || projectCreated > lastNoteAt)) {
        notesLastByProject.set(pid, projectCreated);
      }
    }

    // Compose output
    return projects.map((p) => {
      const t = tasksByProject.get(p._id) || { open: 0, overdue: 0, dueSoon: 0, blocked: 0, next: [], lastTaskAt: null };
      const n = notesByProject.get(p._id) || { notes7d: 0 };
      const lastNoteAt = notesLastByProject.get(p._id) || null;
      // Ignore project updatedAt to avoid pollution from panorama reordering; rely on tasks/notes
      const contentUpdatedAtTime = 0;
      const maxTime = Math.max(
        lastNoteAt ? lastNoteAt.getTime() : 0,
        t.lastTaskAt ? t.lastTaskAt.getTime() : 0,
        contentUpdatedAtTime,
        0 // avoid -Infinity
      );
      const lastActivityAt = maxTime > 0 ? new Date(maxTime) : null;
      const isInactive = !lastActivityAt || (Date.now() - lastActivityAt.getTime()) > (periodDays * 864e5);
      const health = computeHealth({ t, n, dormant: isInactive });
      return {
        _id: p._id,
        name: p.name || '(untitled project)',
        tags: p.tags || [],
        createdAt: p.createdAt || null,
        panoramaRank: Number.isFinite(p.panoramaRank) ? p.panoramaRank : null,
        panoramaStatus: typeof p.panoramaStatus === 'string' ? p.panoramaStatus : null,
        lastActivityAt,
        isInactive,
        heat: { notes: n.notes7d || 0, tasksChanged: t.changedInPeriod || 0 },
        tasks: { open: t.open || 0, overdue: t.overdue || 0, blocked: t.blocked || 0, dueSoon: t.dueSoon || 0, next: t.next || [] },
        notes: { lastStatusAt: null, decisions7d: 0, risks7d: 0, blockers7d: 0 },
        health
      };
    });
  }
});

Meteor.methods({
  async 'panorama.setRank'(projectId, rank) {
    check(projectId, String);
    const n = Number(rank);
    if (!Number.isFinite(n)) throw new Meteor.Error('invalid-rank', 'rank must be a finite number');
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    // Do not touch updatedAt to avoid polluting last activity with UI reordering
    await ProjectsCollection.updateAsync(projectId, { $set: { panoramaRank: n, panoramaUpdatedAt: new Date() } });
    return true;
  }
});


