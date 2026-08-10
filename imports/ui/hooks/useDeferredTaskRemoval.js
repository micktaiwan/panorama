import { useSyncExternalStore } from 'react';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { notify } from '/imports/ui/utils/notify.js';

const UNDO_WINDOW_MS = 5000;
const STORAGE_KEY = 'panorama.pendingTaskRemovals';

/**
 * Deferred task deletion with an Undo toast.
 * The task is hidden immediately; the actual server removal (`tasks.remove`)
 * fires after UNDO_WINDOW_MS unless the user clicks Undo.
 *
 * State lives at module level, not in the component, for two reasons:
 *  - navigating away and back must not un-hide a task whose removal is still
 *    pending (a fresh component would start with an empty hidden set);
 *  - the pending ids are mirrored in localStorage so a reload or an app quit
 *    inside the undo window still deletes the task instead of silently
 *    resurrecting it.
 */

let hiddenTaskIds = new Set(); // immutable snapshot, replaced on every change
const timers = new Map(); // taskId -> timeout handle
const listeners = new Set();

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const getSnapshot = () => hiddenTaskIds;

const setHidden = (next) => {
  hiddenTaskIds = next;
  listeners.forEach(fn => fn());
};

const hide = (taskId) => {
  if (hiddenTaskIds.has(taskId)) return;
  const next = new Set(hiddenTaskIds);
  next.add(taskId);
  setHidden(next);
};

const unhide = (taskId) => {
  if (!hiddenTaskIds.has(taskId)) return;
  const next = new Set(hiddenTaskIds);
  next.delete(taskId);
  setHidden(next);
};

const readPending = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
};

const writePending = (ids) => {
  if (ids.length === 0) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
};

const addPending = (taskId) => {
  const ids = readPending();
  if (!ids.includes(taskId)) writePending([...ids, taskId]);
};

const clearPending = (taskId) => {
  writePending(readPending().filter(id => id !== taskId));
};

// `replayed` removals are re-sent after a reload: the first attempt may well
// have reached the server before the page died, so 'not-found' is the expected
// outcome and must not raise an error toast.
const sendRemoval = (taskId, { replayed = false } = {}) => {
  Meteor.call('tasks.remove', taskId, (err) => {
    clearPending(taskId);
    // Drop the stale hidden entry once the deletion resolves either way;
    // on error, un-hiding brings the task back into view.
    unhide(taskId);
    if (!err) return;
    if (replayed) {
      console.warn('[tasks] replayed removal failed', taskId, err);
      return;
    }
    notify({ message: err.reason || err.message || 'Failed to delete task', kind: 'error' });
  });
};

// The page is going away: send every pending removal now, fire and forget.
// The localStorage entries are kept on purpose — nothing guarantees these calls
// left the socket, so the next startup replays whatever is left.
const flushPendingRemovals = () => {
  timers.forEach((timer, taskId) => {
    clearTimeout(timer);
    Meteor.call('tasks.remove', taskId);
  });
  timers.clear();
};

const replayPendingRemovals = () => {
  readPending().forEach(taskId => sendRemoval(taskId, { replayed: true }));
};

const cancelRemoval = (taskId) => {
  const timer = timers.get(taskId);
  if (!timer) return; // removal already fired, nothing left to undo
  clearTimeout(timer);
  timers.delete(taskId);
  clearPending(taskId);
  unhide(taskId);
};

const requestRemoveTask = (taskId) => {
  if (!taskId) return;
  if (timers.has(taskId)) return; // already pending

  hide(taskId);
  addPending(taskId);

  const timer = setTimeout(() => {
    timers.delete(taskId);
    sendRemoval(taskId);
  }, UNDO_WINDOW_MS);
  timers.set(taskId, timer);

  notify({
    message: 'Task deleted',
    kind: 'info',
    durationMs: UNDO_WINDOW_MS,
    action: { label: 'Undo', onClick: () => cancelRemoval(taskId) },
  });
};

Meteor.startup(() => {
  window.addEventListener('pagehide', flushPendingRemovals);
  // `tasks.remove` needs a logged-in user; wait for the resumed login session.
  Tracker.autorun((computation) => {
    if (!Meteor.userId()) return;
    computation.stop();
    replayPendingRemovals();
  });
});

/**
 * Returns:
 *  - hiddenTaskIds: Set of task ids to filter out of the rendered lists
 *  - requestRemoveTask(taskId): start the deferred deletion + toast
 */
export const useDeferredTaskRemoval = () => {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { hiddenTaskIds: hidden, requestRemoveTask };
};
