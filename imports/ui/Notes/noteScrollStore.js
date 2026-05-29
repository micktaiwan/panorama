// Remembers the scroll position of each note's editor, keyed by noteId.
// Survives:
//   - tab switches (ProseMirrorEditor remount via key={activeTabId})
//   - closing/reopening a note in the same session
//   - full page reloads (mirrored to localStorage)
//
// In-memory Map is the source of truth for reads/writes (scroll events fire
// at frame rate); localStorage is mirrored on a debounced write to avoid
// hammering the disk while the user scrolls.

const STORAGE_KEY = 'panorama.noteScrollPositions';
const FLUSH_DEBOUNCE_MS = 250;
// Hard cap to keep localStorage bounded if the user opens many notes over time.
// LRU by last write order (Map preserves insertion order).
const MAX_ENTRIES = 500;

const loadFromStorage = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return new Map();
    return new Map(Object.entries(obj).map(([k, v]) => [k, Number(v) || 0]));
  } catch {
    return new Map();
  }
};

const positions = loadFromStorage();

const writeNow = () => {
  if (typeof localStorage === 'undefined') return;
  // Evict oldest entries beyond the cap (Map iteration is insertion-ordered)
  while (positions.size > MAX_ENTRIES) {
    const oldestKey = positions.keys().next().value;
    positions.delete(oldestKey);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Quota exceeded or storage disabled — silently drop, scroll is not critical
  }
};

let flushTimer = null;
const scheduleFlush = () => {
  if (typeof localStorage === 'undefined') return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeNow();
  }, FLUSH_DEBOUNCE_MS);
};

// Make sure the latest position lands on disk before the page goes away
// (reload, navigation, tab close). The debounced flush may not have fired yet.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (flushTimer === null) return;
    clearTimeout(flushTimer);
    flushTimer = null;
    writeNow();
  });
}

export const noteScrollStore = {
  get(noteId) { return noteId ? (positions.get(noteId) ?? 0) : 0; },
  set(noteId, top) {
    if (!noteId) return;
    const value = Number(top) || 0;
    // Re-insert to refresh LRU order
    positions.delete(noteId);
    positions.set(noteId, value);
    scheduleFlush();
  },
  clear(noteId) {
    if (!noteId) return;
    positions.delete(noteId);
    scheduleFlush();
  },
};
