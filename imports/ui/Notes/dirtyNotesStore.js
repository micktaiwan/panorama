import { useSyncExternalStore } from 'react';

let count = 0;
let quitting = false;
const listeners = new Set();

const emit = () => { for (const l of listeners) l(); };

export const dirtyNotesStore = {
  setCount(n) {
    const next = Number(n) || 0;
    if (next === count) return;
    count = next;
    emit();
  },
  getCount() { return count; },
  setQuitting(v) { quitting = !!v; },
  isQuitting() { return quitting; },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useDirtyNotesCount = () =>
  useSyncExternalStore(dirtyNotesStore.subscribe, dirtyNotesStore.getCount, dirtyNotesStore.getCount);
