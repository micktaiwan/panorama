import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

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
    ensureLoggedIn(this.userId);
    if (projFilters && typeof projFilters !== 'object') throw new Meteor.Error('invalid-arg', 'projFilters must be an object');
    const k = String(windowKey || '').toLowerCase();
    const userId = this.userId;
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

    // Fetch all project IDs the user has access to (owner or member)
    const accessibleProjects = await ProjectsCollection.find(
      { memberIds: userId },
      { fields: { _id: 1 } }
    ).fetchAsync();
    let accessibleIds = accessibleProjects.map(p => p._id);

    // Apply project filters
    if (includeIds.size > 0) {
      accessibleIds = accessibleIds.filter(id => includeIds.has(id));
    } else if (excludeIds.size > 0) {
      accessibleIds = accessibleIds.filter(id => !excludeIds.has(id));
    }

    const projectSelector = { _id: { $in: accessibleIds }, createdAt: { $gte: since } };
    const taskSelector = { projectId: { $in: accessibleIds }, status: 'done', statusChangedAt: { $gte: since } };
    const noteSelector = { projectId: { $in: accessibleIds }, createdAt: { $gte: since } };

    const [projects, tasksDone, notes] = await Promise.all([
      ProjectsCollection.find(projectSelector, { fields: { name: 1, userId: 1, createdAt: 1 } }).fetchAsync(),
      TasksCollection.find(taskSelector, { fields: { title: 1, projectId: 1, statusChangedAt: 1, updatedAt: 1 } }).fetchAsync(),
      NotesCollection.find(noteSelector, { fields: { title: 1, projectId: 1, createdAt: 1 } }).fetchAsync()
    ]);

    // Resolve creator display names for projects
    const creatorIds = [...new Set(projects.map(p => p.userId).filter(Boolean))];
    const creators = creatorIds.length > 0
      ? await Meteor.users.find({ _id: { $in: creatorIds } }, { fields: { username: 1, 'profile.name': 1, 'emails.address': 1 } }).fetchAsync()
      : [];
    const creatorMap = new Map();
    for (const u of creators) {
      creatorMap.set(u._id, u.username || u.profile?.name || u.emails?.[0]?.address || '');
    }

    const events = [];
    for (const p of projects) {
      events.push({
        type: 'project_created',
        id: p._id,
        projectId: p._id,
        title: p.name || '(untitled project)',
        when: p.createdAt,
        createdBy: creatorMap.get(p.userId) || ''
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


