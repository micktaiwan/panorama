// Focus: the few workstreams (max 3) that drive the user's arbitrations.
// Stored on userPreferences.focus as [{ title, projectIds, taskIds }].
// Shared by the Overview page and the MCP tools so both compute the same
// "next action" for a workstream.

import { CLOSED_TASK_STATUSES, taskStatusRank } from '/imports/api/_shared/taskStatus';

export const FOCUS_MAX_ITEMS = 3;

const toIdList = (v) => (Array.isArray(v) ? v : [])
  .map(x => String(x || '').trim())
  .filter(Boolean)
  .filter((x, i, arr) => arr.indexOf(x) === i);

// Normalizes untrusted input into stored focus items. Throws on invalid shape.
export const normalizeFocusItems = (items) => {
  if (!Array.isArray(items)) throw new Error('focus must be an array');
  if (items.length > FOCUS_MAX_ITEMS) throw new Error(`focus accepts at most ${FOCUS_MAX_ITEMS} items`);
  return items.map((it) => {
    const title = String(it?.title || '').trim();
    if (!title) throw new Error('each focus item needs a title');
    return { title, projectIds: toIdList(it?.projectIds), taskIds: toIdList(it?.taskIds) };
  });
};

const isOpen = (t) => !t?.deletedAt && !CLOSED_TASK_STATUSES.includes(t?.status || 'todo');
const isSnoozedAt = (t, nowMs) => !!t?.snoozedUntil && new Date(t.snoozedUntil).getTime() > nowMs;

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isOverdueAt = (t, nowMs) => {
  if (!t?.deadline) return false;
  const dl = new Date(t.deadline);
  return new Date(dl.getFullYear(), dl.getMonth(), dl.getDate()).getTime() <= startOfDay(nowMs);
};

// Same order as the Overview task list: work in flight, then deadline, then
// manual priority, then oldest first.
const compareNextAction = (a, b) => {
  const as = taskStatusRank(a.status || 'todo');
  const bs = taskStatusRank(b.status || 'todo');
  if (as !== bs) return as - bs;
  const ad = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
  const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
  if (ar !== br) return ar - br;
  return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
};

// Computes what the Overview shows for one focus item, from the tasks the
// caller can see. Pinned tasks (taskIds) win over project tasks for the next
// action, in the order they were pinned.
export const computeFocusState = (item, tasks, nowMs = Date.now()) => {
  const projectIds = new Set(item?.projectIds || []);
  const taskIds = item?.taskIds || [];
  const byId = new Map(tasks.map(t => [t._id, t]));

  const pinnedOpen = taskIds.map(id => byId.get(id)).filter(t => t && isOpen(t));
  const projectOpen = tasks.filter(t => projectIds.has(t.projectId) && isOpen(t));
  const scope = [...pinnedOpen, ...projectOpen.filter(t => !taskIds.includes(t._id))];

  const awake = scope.filter(t => !isSnoozedAt(t, nowMs));
  const nextAction = pinnedOpen.find(t => !isSnoozedAt(t, nowMs))
    || [...awake].sort(compareNextAction)[0]
    || null;

  const lastActivityMs = tasks
    .filter(t => projectIds.has(t.projectId) || taskIds.includes(t._id))
    .reduce((max, t) => Math.max(max, new Date(t.updatedAt || t.statusChangedAt || t.createdAt || 0).getTime()), 0);

  return {
    nextAction,
    openCount: scope.length,
    overdueCount: awake.filter(t => isOverdueAt(t, nowMs)).length,
    lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs) : null,
  };
};
