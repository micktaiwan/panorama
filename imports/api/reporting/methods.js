import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';

const windowKeyToMs = (key) => {
  const k = String(key || '').toLowerCase();
  if (k === '24h' || k === '24') return 24 * 60 * 60 * 1000;
  if (k === '72h' || k === '72') return 72 * 60 * 60 * 1000;
  if (k === '3w' || k === '3weeks' || k === '21d' || k === '21') return 21 * 24 * 60 * 60 * 1000;
  if (k === '7d' || k === '7days' || k === 'last7days' || k === '7') return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000; // default 24h
};

Meteor.methods({
  async 'reporting.recentActivity'(windowKey, projFilters) {
    check(windowKey, String);
    if (projFilters && typeof projFilters !== 'object') throw new Meteor.Error('invalid-arg', 'projFilters must be an object');
    const k = String(windowKey || '').toLowerCase();
    let since;
    let until;
    if (k === 'all') {
      since = new Date(0);
      until = new Date();
    } else {
      const windowMs = windowKeyToMs(windowKey);
      since = new Date(Date.now() - windowMs);
      until = new Date();
    }

    const includeIds = new Set(Object.entries(projFilters || {}).filter(([, v]) => v === 1).map(([k]) => k));
    const excludeIds = new Set(Object.entries(projFilters || {}).filter(([, v]) => v === -1).map(([k]) => k));

    const projectSelector = { createdAt: { $gte: since } };
    const taskSelector = { status: 'done', statusChangedAt: { $gte: since } };
    const noteSelector = { createdAt: { $gte: since } };
    if (excludeIds.size > 0 || includeIds.size > 0) {
      const idCond = includeIds.size > 0 ? { $in: Array.from(includeIds) } : { $nin: Array.from(excludeIds) };
      // For projects: filter by _id
      projectSelector._id = idCond;
      // For tasks/notes: filter by projectId
      taskSelector.projectId = idCond;
      noteSelector.projectId = idCond;
    }

    const [projects, tasksDone, notes] = await Promise.all([
      ProjectsCollection.find(projectSelector, { fields: { name: 1, createdAt: 1 } }).fetchAsync(),
      TasksCollection.find(taskSelector, { fields: { title: 1, projectId: 1, statusChangedAt: 1, updatedAt: 1 } }).fetchAsync(),
      NotesCollection.find(noteSelector, { fields: { title: 1, projectId: 1, createdAt: 1 } }).fetchAsync()
    ]);

    const events = [];
    for (const p of projects) {
      events.push({
        type: 'project_created',
        id: p._id,
        projectId: p._id,
        title: p.name || '(untitled project)',
        when: p.createdAt
      });
    }
    for (const t of tasksDone) {
      events.push({
        type: 'task_done',
        id: t._id,
        projectId: t.projectId || null,
        title: t.title || '(untitled task)',
        when: t.statusChangedAt || t.updatedAt || new Date()
      });
    }
    for (const n of notes) {
      events.push({
        type: 'note_created',
        id: n._id,
        projectId: n.projectId || null,
        title: n.title || '(note)',
        when: n.createdAt
      });
    }

    events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return { windowKey, since, until, count: events.length, events };
  }
});


