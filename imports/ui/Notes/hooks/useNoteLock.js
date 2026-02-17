import { useRef, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';

/**
 * Hook to manage note lock lifecycle.
 * Exposes acquireLock / releaseLock and cleans up on unmount.
 */
export function useNoteLock() {
  const lockedNoteIdsRef = useRef(new Set());

  const acquireLock = useCallback(async (noteId) => {
    if (!noteId || lockedNoteIdsRef.current.has(noteId)) return;
    try {
      await Meteor.callAsync('notes.acquireLock', noteId);
      lockedNoteIdsRef.current.add(noteId);
    } catch (err) {
      if (err?.error === 'note-locked') {
        notify({ message: 'This note is being edited by another user', kind: 'warning' });
      }
    }
  }, []);

  const releaseLock = useCallback(async (noteId) => {
    if (!noteId || !lockedNoteIdsRef.current.has(noteId)) return;
    lockedNoteIdsRef.current.delete(noteId);
    try {
      await Meteor.callAsync('notes.releaseLock', noteId);
    } catch {
      // fire-and-forget
    }
  }, []);

  // Cleanup: release all locks on unmount
  useEffect(() => {
    const ref = lockedNoteIdsRef.current;
    return () => {
      for (const noteId of ref) {
        Meteor.callAsync('notes.releaseLock', noteId).catch(() => {});
      }
      ref.clear();
    };
  }, []);

  return { acquireLock, releaseLock };
}
