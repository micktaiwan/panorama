import { useCallback, useEffect, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';

const UNDO_WINDOW_MS = 5000;

/**
 * Deferred task deletion with an Undo toast.
 * The task is hidden locally immediately; the actual server removal
 * (`tasks.remove`) fires after UNDO_WINDOW_MS unless the user clicks Undo.
 *
 * Returns:
 *  - hiddenTaskIds: Set of task ids to filter out of the rendered lists
 *  - requestRemoveTask(taskId): start the deferred deletion + toast
 */
export const useDeferredTaskRemoval = () => {
  const [hiddenTaskIds, setHiddenTaskIds] = useState(() => new Set());
  const timersRef = useRef(new Map()); // taskId -> timeout handle
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const unhide = useCallback((taskId) => {
    setHiddenTaskIds(prev => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, []);

  const requestRemoveTask = useCallback((taskId) => {
    if (!taskId) return;
    if (timersRef.current.has(taskId)) return; // already pending

    setHiddenTaskIds(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });

    const timer = setTimeout(() => {
      timersRef.current.delete(taskId);
      Meteor.call('tasks.remove', taskId, (err) => {
        // Drop the stale hidden entry once the deletion resolves either way;
        // on error, un-hiding brings the task back into view.
        if (mountedRef.current) unhide(taskId);
        if (err) {
          notify({ message: err.reason || err.message || 'Failed to delete task', kind: 'error' });
        }
      });
    }, UNDO_WINDOW_MS);
    timersRef.current.set(taskId, timer);

    notify({
      message: 'Task deleted',
      kind: 'info',
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const t = timersRef.current.get(taskId);
          if (t) { clearTimeout(t); timersRef.current.delete(taskId); }
          unhide(taskId);
        }
      }
    });
  }, [unhide]);

  return { hiddenTaskIds, requestRemoveTask };
};
