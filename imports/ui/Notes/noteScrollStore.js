// Remembers the scroll position of each note's editor, keyed by noteId.
// Survives the ProseMirrorEditor remount triggered by key={activeTabId} on tab switch.
const positions = new Map();

export const noteScrollStore = {
  get(noteId) { return noteId ? (positions.get(noteId) ?? 0) : 0; },
  set(noteId, top) {
    if (!noteId) return;
    positions.set(noteId, Number(top) || 0);
  },
  clear(noteId) { if (noteId) positions.delete(noteId); },
};
