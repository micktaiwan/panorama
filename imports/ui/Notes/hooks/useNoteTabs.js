import { useState, useEffect, useMemo, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';
import { useNoteLock } from './useNoteLock.js';

// Constants
const FOCUS_DELAY_MS = 200;

// ---- localStorage helpers ----

const parseLocalJson = (key, fallback) => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    console.error('[useNoteTabs] Failed to parse localStorage JSON for key', key, e);
    return fallback;
  }
};

const getDraftFor = (noteId) => {
  const raw = localStorage.getItem(`note-content-${noteId}`);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      const savedAt = Number(parsed.savedAt) || 0;
      return { content: String(parsed.content || ''), savedAt };
    }
    return { content: String(raw || ''), savedAt: 0 };
  } catch (e) {
    console.error('[useNoteTabs] Failed to parse draft JSON for note', noteId, e);
    return { content: String(raw || ''), savedAt: 0 };
  }
};

const setDraftFor = (noteId, content, baselineContent) => {
  if (String(content || '') === String(baselineContent || '')) {
    localStorage.removeItem(`note-content-${noteId}`);
    return;
  }
  const payload = { content: String(content || ''), savedAt: Date.now() };
  localStorage.setItem(`note-content-${noteId}`, JSON.stringify(payload));
};

/**
 * Custom hook that manages all note tab/draft/content logic.
 *
 * @param {Object} params
 * @param {Array} params.notes - All available notes from subscription
 * @param {Map} params.notesById - Map of noteId → note for fast lookup
 * @param {string|null} params.storageKey - When non-null, persists tabs in localStorage with this prefix.
 *   When null, everything is in-memory only.
 * @param {string} [params.defaultProjectId] - When provided, auto-assigned to new notes on creation.
 */
export function useNoteTabs({ notes, notesById, storageKey = null, defaultProjectId = null }) {
  // ---- Lock management ----
  const { acquireLock, releaseLock } = useNoteLock();

  // ---- Core state ----
  const [searchTerm, setSearchTerm] = useState('');
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [noteContents, setNoteContents] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [renamedTabs, setRenamedTabs] = useState(new Set());
  const [touchedNotes, setTouchedNotes] = useState(new Set());
  const [shouldFocusNote, setShouldFocusNote] = useState(null);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [showOnlyOpen, setShowOnlyOpen] = useState(() => {
    if (storageKey && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(`${storageKey}.showOnlyOpen`) === 'true';
    }
    return false;
  });
  const [fileBaselines, setFileBaselines] = useState({});

  // ---- localStorage key helpers ----
  const lsKey = useCallback((suffix) => storageKey ? `${storageKey}-${suffix}` : null, [storageKey]);

  // ---- Load open tabs from localStorage on mount ----
  useEffect(() => {
    if (!storageKey) return;

    const savedActiveTab = localStorage.getItem(lsKey('active-tab'));
    const tabs = parseLocalJson(lsKey('open-tabs'), []);
    if (tabs && Array.isArray(tabs) && tabs.length > 0) {
      const seenIds = new Set();
      const validTabs = tabs.filter(tab => {
        if (!tab || typeof tab.id !== 'string' || tab.id.trim() === '') return false;
        if (seenIds.has(tab.id)) return false;
        seenIds.add(tab.id);
        return true;
      });
      setOpenTabs(validTabs);

      const contents = {};
      const fileTabs = [];
      validTabs.forEach(tab => {
        if (tab.type === 'file') {
          fileTabs.push(tab);
          return;
        }
        const draft = getDraftFor(tab.id);
        const snapshotUpdatedAt = tab?.note?.updatedAt ? new Date(tab.note.updatedAt).getTime() : 0;
        if (draft) {
          if (snapshotUpdatedAt > (draft.savedAt || 0)) {
            contents[tab.id] = tab?.note?.content || '';
          } else {
            contents[tab.id] = draft.content;
          }
        } else {
          contents[tab.id] = tab?.note?.content || '';
        }
      });
      setNoteContents(contents);

      if (fileTabs.length > 0) {
        Promise.all(fileTabs.map(async (tab) => {
          try {
            const result = await Meteor.callAsync('diskFile.read', tab.filePath);
            return { tabId: tab.id, content: result.content };
          } catch {
            return { tabId: tab.id, content: null };
          }
        })).then(results => {
          const fileContents = {};
          const baselines = {};
          for (const r of results) {
            if (r.content !== null) {
              fileContents[r.tabId] = r.content;
              baselines[r.tabId] = r.content;
            }
          }
          setNoteContents(prev => ({ ...prev, ...fileContents }));
          setFileBaselines(prev => ({ ...prev, ...baselines }));
        });
      }

      if (savedActiveTab && validTabs.find(tab => tab.id === savedActiveTab)) {
        setActiveTabId(savedActiveTab);
      } else if (validTabs.length > 0) {
        setActiveTabId(validTabs[validTabs.length - 1].id);
      }
    }

    const renamedTabsArray = parseLocalJson(lsKey('renamed-tabs'), []);
    if (Array.isArray(renamedTabsArray) && renamedTabsArray.length > 0) {
      setRenamedTabs(new Set(renamedTabsArray));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Persist open tabs ----
  useEffect(() => {
    if (!storageKey) return;
    if (openTabs.length > 0) {
      const seenIds = new Set();
      const uniqueTabs = openTabs.filter(tab => {
        if (seenIds.has(tab.id)) return false;
        seenIds.add(tab.id);
        return true;
      });
      if (uniqueTabs.length !== openTabs.length) {
        setOpenTabs(uniqueTabs);
        return;
      }
      localStorage.setItem(lsKey('open-tabs'), JSON.stringify(openTabs));
    } else {
      localStorage.removeItem(lsKey('open-tabs'));
    }
  }, [openTabs, storageKey, lsKey]);

  // ---- Persist active tab ----
  useEffect(() => {
    if (!storageKey) return;
    if (activeTabId) {
      localStorage.setItem(lsKey('active-tab'), activeTabId);
    } else {
      localStorage.removeItem(lsKey('active-tab'));
    }
  }, [activeTabId, storageKey, lsKey]);

  // ---- Persist showOnlyOpen ----
  useEffect(() => {
    if (!storageKey) return;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${storageKey}.showOnlyOpen`, String(showOnlyOpen));
    }
  }, [showOnlyOpen, storageKey]);

  // ---- Persist drafts (skip file tabs) ----
  useEffect(() => {
    Object.keys(noteContents).forEach(noteId => {
      if (!touchedNotes.has(noteId)) return;
      const tab = openTabs.find(t => t.id === noteId);
      if (tab?.type === 'file') return;
      const dbBaseline = notesById.get(noteId)?.content ?? tab?.note?.content ?? '';
      setDraftFor(noteId, noteContents[noteId], dbBaseline);
    });
  }, [noteContents, notesById, openTabs.length, openTabs.map(t => `${t.id}:${t?.note?.content || ''}`).join(','), touchedNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Persist renamed tabs ----
  useEffect(() => {
    if (!storageKey) return;
    if (renamedTabs.size > 0) {
      localStorage.setItem(lsKey('renamed-tabs'), JSON.stringify([...renamedTabs]));
    } else {
      localStorage.removeItem(lsKey('renamed-tabs'));
    }
  }, [renamedTabs, storageKey, lsKey]);

  // ---- Invalidate drafts when DB updates are more recent ----
  useEffect(() => {
    if (!openTabs.length) return;
    const next = { ...noteContents };
    let changed = false;
    for (const tab of openTabs) {
      const db = notesById.get(tab.id);
      if (!db) continue;
      const draft = getDraftFor(tab.id);
      const dbUpdatedAt = db?.updatedAt ? new Date(db.updatedAt).getTime() : 0;
      const draftSavedAt = draft?.savedAt || 0;
      if (dbUpdatedAt > draftSavedAt) {
        const wanted = db.content || '';
        if ((next[tab.id] ?? '') !== wanted) {
          next[tab.id] = wanted;
          changed = true;
        }
        localStorage.removeItem(`note-content-${tab.id}`);
      }
    }
    if (changed) setNoteContents(next);
  }, [notesById, openTabs.length, openTabs.map(t => t.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Reset focus state after it has been applied ----
  useEffect(() => {
    if (shouldFocusNote) {
      const timer = setTimeout(() => setShouldFocusNote(null), FOCUS_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [shouldFocusNote]);

  // ---- Computed ----

  const filteredNotes = useMemo(() => {
    const lower = searchTerm.toLowerCase();
    const toMs = (d) => (d ? new Date(d).getTime() : 0);
    return notes
      .filter((note) => {
        const matchesSearch = note.title?.toLowerCase().includes(lower) ||
                            note.content?.toLowerCase().includes(lower);
        if (showOnlyOpen) {
          return matchesSearch && openTabs.some(tab => tab.id === note._id);
        }
        return matchesSearch;
      })
      .sort((a, b) => toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt));
  }, [notes, searchTerm, showOnlyOpen, openTabs]);

  const dirtySet = useMemo(() => {
    const set = new Set();
    for (const tab of openTabs) {
      if (tab.type === 'file') {
        const baseline = fileBaselines[tab.id] ?? '';
        const current = noteContents[tab.id] ?? baseline;
        if (current !== baseline) set.add(tab.id);
      } else {
        const dbBaseline = notesById.get(tab.id)?.content ?? tab?.note?.content ?? '';
        const current = (noteContents[tab.id] ?? dbBaseline);
        if (current !== dbBaseline) set.add(tab.id);
      }
    }
    return set;
  }, [openTabs.length, openTabs.map(t => `${t.id}:${t?.note?.content || ''}`).join(','), Object.keys(noteContents).length, notesById, fileBaselines]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Actions ----

  const openNote = (note, shouldFocus = false) => {
    if (!openTabs.find(tab => tab.id === note._id)) {
      const newTab = {
        id: note._id,
        title: note.title || 'Untitled',
        note: note,
      };
      setOpenTabs(prev => [...prev, newTab]);

      const draft = getDraftFor(note._id);
      const dbUpdatedAt = note?.updatedAt ? new Date(note.updatedAt).getTime() : 0;
      let nextContent = note.content || '';
      if (draft) {
        const draftIsNewerOrEqual = (draft.savedAt || 0) >= dbUpdatedAt;
        nextContent = draftIsNewerOrEqual ? draft.content : (note.content || '');
      }

      setNoteContents(prev => {
        const newContents = { ...prev, [note._id]: nextContent };
        setTimeout(() => {
          setActiveTabId(note._id);
          if (shouldFocus) setShouldFocusNote(note._id);
        }, 0);
        return newContents;
      });
    } else {
      setActiveTabId(note._id);
      if (shouldFocus) setShouldFocusNote(note._id);
    }
  };

  const closeTab = (tabId) => {
    releaseLock(tabId);
    let nextActiveTabId = activeTabId;
    if (activeTabId === tabId) {
      const remainingTabs = openTabs.filter(tab => tab.id !== tabId);
      if (remainingTabs.length > 0) {
        nextActiveTabId = remainingTabs[remainingTabs.length - 1].id;
      } else {
        nextActiveTabId = null;
      }
    }

    setOpenTabs(prev => prev.filter(tab => tab.id !== tabId));
    setNoteContents(prev => {
      const newContents = { ...prev };
      delete newContents[tabId];
      return newContents;
    });

    const closingTab = openTabs.find(t => t.id === tabId);
    if (closingTab?.type !== 'file') {
      localStorage.removeItem(`note-content-${tabId}`);
    }
    setTouchedNotes(prev => { const n = new Set(prev); n.delete(tabId); return n; });
    setFileBaselines(prev => { const next = { ...prev }; delete next[tabId]; return next; });
    setRenamedTabs(prev => {
      const newSet = new Set(prev);
      newSet.delete(tabId);
      return newSet;
    });

    if (nextActiveTabId !== activeTabId) {
      setActiveTabId(nextActiveTabId);
    }
  };

  const openFile = async () => {
    if (!window.electron?.openFileDialog) {
      notify({ message: 'File dialog only available in Electron', kind: 'error' });
      return;
    }
    const filePath = await window.electron.openFileDialog();
    if (!filePath) return;

    const tabId = `file:${filePath}`;
    if (openTabs.find(tab => tab.id === tabId)) {
      setActiveTabId(tabId);
      return;
    }
    try {
      const result = await Meteor.callAsync('diskFile.read', filePath);
      const newTab = {
        id: tabId,
        title: result.basename,
        type: 'file',
        filePath,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setNoteContents(prev => ({ ...prev, [tabId]: result.content }));
      setFileBaselines(prev => ({ ...prev, [tabId]: result.content }));
      setActiveTabId(tabId);
    } catch (err) {
      notify({ message: `Failed to open file: ${err.reason || err.message}`, kind: 'error' });
    }
  };

  const saveNote = async (noteId) => {
    if (!noteContents[noteId]) return;

    const tab = openTabs.find(t => t.id === noteId);
    if (tab?.type === 'file') {
      setIsSaving(true);
      try {
        await Meteor.callAsync('diskFile.write', tab.filePath, noteContents[noteId]);
        setFileBaselines(prev => ({ ...prev, [noteId]: noteContents[noteId] }));
        notify({ message: 'File saved', kind: 'success' });
      } catch (error) {
        console.error('Error saving file:', error);
        notify({ message: `Error saving file: ${error.reason || error.message}`, kind: 'error' });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    try {
      const note = notesById.get(noteId);
      const content = noteContents[noteId];
      const isFirstSave = !note?.updatedAt || note.updatedAt === note.createdAt;
      const hasNoTitle = !note?.title || note.title === 'New note' || note.title.trim() === '';
      const updateData = { content };

      if (isFirstSave && hasNoTitle && content.trim()) {
        const firstLine = content.split('\n')[0].trim();
        if (firstLine) {
          updateData.title = firstLine;
          setOpenTabs(prev => prev.map(t =>
            t.id === noteId ? { ...t, title: firstLine } : t
          ));
        }
      }

      try {
        await Meteor.callAsync('notes.update', noteId, updateData);
      } catch (error) {
        if (error?.error === 'vectorization-failed') {
          notify({ message: 'Saved, but search indexing failed.', kind: 'warning' });
        } else {
          throw error;
        }
      }
      // Server releases the lock on content save; clean up client state
      releaseLock(noteId);
      localStorage.removeItem(`note-content-${noteId}`);
      setTouchedNotes(prev => { const n = new Set(prev); n.delete(noteId); return n; });
      setOpenTabs(prev => prev.map(t => t.id === noteId ? { ...t, note: { ...(t.note || {}), content: noteContents[noteId] } } : t));
    } catch (error) {
      console.error('Error saving note:', error);
      notify({ message: 'Error saving note', kind: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateNoteContent = (noteId, content) => {
    // Acquire lock on first edit (idempotent if already locked)
    acquireLock(noteId);
    setNoteContents(prev => ({ ...prev, [noteId]: content }));
    setTouchedNotes(prev => new Set([...prev, noteId]));
  };

  const saveAllNotes = async () => {
    const dirtyTabs = openTabs.filter(tab => dirtySet.has(tab.id));
    if (dirtyTabs.length === 0) {
      notify({ message: 'No unsaved changes to save', kind: 'info' });
      return;
    }
    for (const tab of dirtyTabs) {
      await saveNote(tab.id);
    }
    notify({ message: `Saved ${dirtyTabs.length} note${dirtyTabs.length > 1 ? 's' : ''}`, kind: 'success' });
  };

  const deleteNote = async (noteId) => {
    try {
      releaseLock(noteId);
      await Meteor.callAsync('notes.remove', noteId);
      localStorage.removeItem(`note-content-${noteId}`);
      setTouchedNotes(prev => { const n = new Set(prev); n.delete(noteId); return n; });
      closeTab(noteId);
    } catch (error) {
      console.error('Error deleting note:', error);
      notify({ message: 'Error deleting note', kind: 'error' });
    }
  };

  const handleTabsReorder = (nextOrder) => {
    setOpenTabs((prev) => {
      const map = new Map(prev.map(t => [t.id, t]));
      const reordered = nextOrder.map(id => map.get(id)).filter(Boolean);
      const missing = prev.filter(t => !nextOrder.includes(t.id));
      const next = [...reordered, ...missing];
      if (storageKey && typeof localStorage !== 'undefined') {
        localStorage.setItem(lsKey('open-tabs'), JSON.stringify(next));
      }
      return next;
    });
  };

  const closeOtherTabs = (tabId) => {
    const others = openTabs.filter(t => t.id !== tabId);
    others.forEach(t => {
      releaseLock(t.id);
      if (t.type !== 'file') localStorage.removeItem(`note-content-${t.id}`);
    });
    setOpenTabs(prev => prev.filter(t => t.id === tabId));
    setNoteContents(prev => ({ [tabId]: prev[tabId] }));
    setFileBaselines(prev => {
      const kept = openTabs.find(t => t.id === tabId);
      if (kept?.type === 'file') return { [tabId]: prev[tabId] };
      return {};
    });
    setActiveTabId(tabId);
  };

  const closeAllTabs = () => {
    openTabs.forEach(t => {
      releaseLock(t.id);
      if (t.type !== 'file') localStorage.removeItem(`note-content-${t.id}`);
    });
    setOpenTabs([]);
    setNoteContents({});
    setFileBaselines({});
    setActiveTabId(null);
  };

  const handleTabRename = async (tabId, newTitle) => {
    try {
      try {
        await Meteor.callAsync('notes.update', tabId, { title: newTitle });
      } catch (error) {
        if (error?.error === 'vectorization-failed') {
          notify({ message: 'Renamed, but search indexing failed.', kind: 'warning' });
        } else {
          throw error;
        }
      }
      setOpenTabs(prev => prev.map(tab =>
        tab.id === tabId ? { ...tab, title: newTitle } : tab
      ));
      setRenamedTabs(prev => new Set([...prev, tabId]));
    } catch (error) {
      console.error('Error renaming note:', error);
      notify({ message: 'Error renaming note', kind: 'error' });
    }
  };

  const handleMoveProject = async (noteId, projectId) => {
    try {
      await Meteor.callAsync('notes.update', noteId, { projectId });
      notify({ message: 'Note moved to project', kind: 'success' });
    } catch (error) {
      if (error?.error === 'vectorization-failed') {
        notify({ message: 'Note moved, but search indexing failed.', kind: 'warning' });
      } else {
        console.error('Error moving note:', error);
        notify({ message: 'Error moving note', kind: 'error' });
      }
    }
  };

  const handleDuplicateNote = async (noteId) => {
    try {
      const originalNote = notesById.get(noteId);
      let newNoteId;
      let hadVectorWarning = false;
      try {
        newNoteId = await Meteor.callAsync('notes.duplicate', noteId);
      } catch (error) {
        if (error?.error === 'vectorization-failed' && error?.details?.insertedId) {
          newNoteId = error.details.insertedId;
          hadVectorWarning = true;
        } else {
          throw error;
        }
      }

      // Build optimistic note — subscription may not have pushed the doc yet
      const optimisticNote = {
        _id: newNoteId,
        title: originalNote?.title ? `${originalNote.title} (copy)` : 'Untitled (copy)',
        content: originalNote?.content || '',
        projectId: originalNote?.projectId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      openNote(optimisticNote);
      notify({ message: hadVectorWarning ? 'Note duplicated, but search indexing failed.' : 'Note duplicated successfully', kind: hadVectorWarning ? 'warning' : 'success' });
    } catch (error) {
      console.error('Error duplicating note:', error);
      notify({ message: 'Error duplicating note', kind: 'error' });
    }
  };

  const handleReorderNote = async (noteId, newUpdatedAt) => {
    try {
      await Meteor.callAsync('notes.update', noteId, { updatedAt: newUpdatedAt });
    } catch (error) {
      console.error('Error reordering note:', error);
      notify({ message: 'Error reordering note', kind: 'error' });
    }
  };

  const handleCreateNote = async () => {
    if (isCreatingNote) return;

    setIsCreatingNote(true);
    try {
      const insertData = { title: 'New note', content: '' };
      if (defaultProjectId) insertData.projectId = defaultProjectId;

      const newNoteId = await Meteor.callAsync('notes.insert', insertData);

      if (!newNoteId) {
        throw new Error('No ID returned from notes.insert');
      }

      const newNote = {
        _id: newNoteId,
        title: 'New note',
        content: '',
        projectId: defaultProjectId || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      openNote(newNote, true);
      notify({ message: 'New note created', kind: 'success' });
    } catch (error) {
      console.error('Error creating note:', error);
      notify({ message: 'Error creating note', kind: 'error' });
    } finally {
      setIsCreatingNote(false);
    }
  };

  return {
    // State
    searchTerm, setSearchTerm,
    openTabs, activeTabId, setActiveTabId,
    noteContents, isSaving, shouldFocusNote,
    isCreatingNote, showOnlyOpen, setShowOnlyOpen,

    // Computed
    filteredNotes, dirtySet,

    // Actions
    openNote, closeTab, openFile,
    saveNote, saveAllNotes, updateNoteContent, deleteNote,
    handleTabsReorder, handleTabRename,
    closeOtherTabs, closeAllTabs,
    handleMoveProject, handleDuplicateNote, handleReorderNote,
    handleCreateNote, releaseLock,
  };
}
