import React, { useState, useEffect, useMemo } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { NotesCollection } from '/imports/api/notes/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { notify } from '/imports/ui/utils/notify.js';
import { parseHashRoute } from '/imports/ui/router.js';
import { NotesSearch } from './components/NotesSearch.jsx';
import { NotesList } from './components/NotesList.jsx';
import { NotesTabs } from './components/NotesTabs.jsx';
import { NoteEditor } from './components/NoteEditor.jsx';
import './NotesPage.css';

// Constants
const FOCUS_DELAY_MS = 200;
const FOCUS_TIMEOUT_MS = 50;

export const NotesPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [noteContents, setNoteContents] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [renamedTabs, setRenamedTabs] = useState(new Set());
  const [touchedNotes, setTouchedNotes] = useState(new Set());
  const [shouldFocusNote, setShouldFocusNote] = useState(null);
  const [isCreatingNote, setIsCreatingNote] = useState(false);

  const parseLocalJson = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  };

  // Get all notes early for downstream hooks
  const notes = useTracker(() => {
    Meteor.subscribe('notes');
    return NotesCollection.find({}, { sort: { updatedAt: -1, createdAt: -1 } }).fetch();
  });

  // Fast lookup for current DB state
  const notesById = useMemo(() => {
    const map = new Map();
    for (const n of notes) map.set(n._id, n);
    return map;
  }, [notes]);

  // Draft helpers (JSON-based, backward-compatible)
  const getDraftFor = (noteId) => {
    const raw = localStorage.getItem(`note-content-${noteId}`);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'content' in parsed) {
        const savedAt = Number(parsed.savedAt) || 0;
        return { content: String(parsed.content || ''), savedAt };
      }
      // Backward-compat: raw string content without metadata
      return { content: String(raw || ''), savedAt: 0 };
    } catch (e) {
      // Parsing failed: log and fallback to treating raw as legacy string content
      // eslint-disable-next-line no-console
      console.error('[NotesPage] Failed to parse draft JSON for note', noteId, e);
      return { content: String(raw || ''), savedAt: 0 };
    }
  };

  const setDraftFor = (noteId, content, baselineContent) => {
    // If the draft equals the current DB baseline, avoid storing
    if (String(content || '') === String(baselineContent || '')) {
      localStorage.removeItem(`note-content-${noteId}`);
      return;
    }
    const payload = { content: String(content || ''), savedAt: Date.now() };
    localStorage.setItem(`note-content-${noteId}`, JSON.stringify(payload));
  };

  // Load open tabs from localStorage on mount
  useEffect(() => {
    const savedActiveTab = localStorage.getItem('notes-active-tab');
    const tabs = parseLocalJson('notes-open-tabs', []);
    if (tabs && Array.isArray(tabs) && tabs.length > 0) {
      // Filter out tabs without valid IDs to prevent prop validation errors
      const validTabs = tabs.filter(tab => tab && typeof tab.id === 'string' && tab.id.trim() !== '');
      setOpenTabs(validTabs);
      // Load content of open notes
      const contents = {};
      validTabs.forEach(tab => {
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
      if (savedActiveTab && validTabs.find(tab => tab.id === savedActiveTab)) {
        setActiveTabId(savedActiveTab);
      } else if (validTabs.length > 0) {
        setActiveTabId(validTabs[validTabs.length - 1].id);
      }
    }

    const renamedTabsArray = parseLocalJson('notes-renamed-tabs', []);
    if (Array.isArray(renamedTabsArray) && renamedTabsArray.length > 0) {
      setRenamedTabs(new Set(renamedTabsArray));
    }
  }, []);

  // Save open tabs to localStorage
  useEffect(() => {
    if (openTabs.length > 0) {
      localStorage.setItem('notes-open-tabs', JSON.stringify(openTabs));
    } else {
      localStorage.removeItem('notes-open-tabs');
    }
  }, [openTabs]);

  // Save active tab to localStorage
  useEffect(() => {
    if (activeTabId) {
      localStorage.setItem('notes-active-tab', activeTabId);
    } else {
      localStorage.removeItem('notes-active-tab');
    }
  }, [activeTabId]);

  // Save note contents to localStorage (JSON with savedAt), avoid storing if equals DB baseline
  useEffect(() => {
    Object.keys(noteContents).forEach(noteId => {
      // Only persist drafts for notes that were actively edited by the user
      if (!touchedNotes.has(noteId)) return;
      const dbBaseline = notesById.get(noteId)?.content ?? openTabs.find(t => t.id === noteId)?.note?.content ?? '';
      setDraftFor(noteId, noteContents[noteId], dbBaseline);
    });
  }, [noteContents, notesById, openTabs.length, openTabs.map(t => `${t.id}:${t?.note?.content || ''}`).join(','), touchedNotes]);

  // Save renamed tabs to localStorage
  useEffect(() => {
    if (renamedTabs.size > 0) {
      localStorage.setItem('notes-renamed-tabs', JSON.stringify([...renamedTabs]));
    } else {
      localStorage.removeItem('notes-renamed-tabs');
    }
  }, [renamedTabs]);

  // Invalidate drafts when DB updates are more recent
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
  }, [notesById, openTabs.length, openTabs.map(t => t.id).join(',')]);

  // Clean localStorage on component unmount
  useEffect(() => {
    return () => {
      // Don't clean automatically, keep data for next load
    };
  }, []);

  // Reset focus state after it has been applied
  useEffect(() => {
    if (shouldFocusNote) {
      // Reset the focus state after a delay to allow the focus to be applied
      const timer = setTimeout(() => {
        setShouldFocusNote(null);
      }, FOCUS_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [shouldFocusNote]);

  // Projects data - single subscription to avoid duplication
  const projects = useTracker(() => {
    Meteor.subscribe('projects');
    return ProjectsCollection.find({}, { fields: { name: 1 } }).fetch();
  });

  const projectNamesById = useMemo(() => {
    const map = {};
    projects.forEach(p => { map[p._id] = p?.name || '(untitled project)'; });
    return map;
  }, [projects]);

  const projectOptions = useMemo(() => {
    return projects
      .map(p => ({ value: p._id, label: p?.name || '(untitled project)' }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  // Filter + sort by (updatedAt || createdAt) desc
  const filteredNotes = useMemo(() => {
    const lower = searchTerm.toLowerCase();
    const toMs = (d) => (d ? new Date(d).getTime() : 0);
    return notes
      .filter((note) =>
        note.title?.toLowerCase().includes(lower) ||
        note.content?.toLowerCase().includes(lower)
      )
      .sort((a, b) => toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt));
  }, [notes, searchTerm]);

  // Dirty tabs: compare against current DB baseline when available
  const dirtySet = useMemo(() => {
    const set = new Set();
    for (const tab of openTabs) {
      const dbBaseline = notesById.get(tab.id)?.content ?? tab?.note?.content ?? '';
      const current = (noteContents[tab.id] ?? dbBaseline);
      if (current !== dbBaseline) set.add(tab.id);
    }
    return set;
  }, [openTabs.length, openTabs.map(t => `${t.id}:${t?.note?.content || ''}`).join(','), Object.keys(noteContents).length, notesById]);

  // Open a note in a new tab
  const openNote = (note, shouldFocus = false) => {
    if (!openTabs.find(tab => tab.id === note._id)) {
      const newTab = {
        id: note._id,
        title: note.title || 'Untitled',
        note: note
      };
      setOpenTabs(prev => [...prev, newTab]);

      // Prefer most recent between draft and DB
      const draft = getDraftFor(note._id);
      const dbUpdatedAt = note?.updatedAt ? new Date(note.updatedAt).getTime() : 0;
      let nextContent = note.content || '';
      if (draft) {
        const draftIsNewerOrEqual = (draft.savedAt || 0) >= dbUpdatedAt;
        nextContent = draftIsNewerOrEqual ? draft.content : (note.content || '');
      }
      
      // Set content first, then activeTabId in the same state update
      setNoteContents(prev => {
        const newContents = { ...prev, [note._id]: nextContent };
        // Use setTimeout to ensure noteContents is updated before activeTabId
        setTimeout(() => {
          setActiveTabId(note._id);
          if (shouldFocus) {
            setShouldFocusNote(note._id);
          }
        }, 0);
        return newContents;
      });
    } else {
      // Tab already exists, just set activeTabId
      setActiveTabId(note._id);
      if (shouldFocus) {
        setShouldFocusNote(note._id);
      }
    }
  };

  // Close a tab
  const closeTab = (tabId) => {
    setOpenTabs(prev => prev.filter(tab => tab.id !== tabId));
    setNoteContents(prev => {
      const newContents = { ...prev };
      delete newContents[tabId];
      return newContents;
    });
    
    // Clean localStorage for this note
    localStorage.removeItem(`note-content-${tabId}`);
    setTouchedNotes(prev => { const n = new Set(prev); n.delete(tabId); return n; });
    
    // Remove from renamed tabs set
    setRenamedTabs(prev => {
      const newSet = new Set(prev);
      newSet.delete(tabId);
      return newSet;
    });
    
    // If closing active tab, activate previous or next
    if (activeTabId === tabId) {
      const remainingTabs = openTabs.filter(tab => tab.id !== tabId);
      if (remainingTabs.length > 0) {
        setActiveTabId(remainingTabs[remainingTabs.length - 1].id);
      } else {
        setActiveTabId(null);
      }
    }
  };

  // Save a note
  const saveNote = async (noteId) => {
    if (!noteContents[noteId]) return;
    
    setIsSaving(true);
    try {
      const note = notesById.get(noteId);
      const content = noteContents[noteId];
      
      // Check if this is the first save and note has no title
      const isFirstSave = !note?.updatedAt || note.updatedAt === note.createdAt;
      const hasNoTitle = !note?.title || note.title === 'New note' || note.title.trim() === '';
      
      let updateData = { content };
      
      // Auto-generate title from first line if it's first save and no title
      if (isFirstSave && hasNoTitle && content.trim()) {
        const firstLine = content.split('\n')[0].trim();
        if (firstLine) {
          updateData.title = firstLine;
          // Update the tab title locally
          setOpenTabs(prev => prev.map(tab => 
            tab.id === noteId ? { ...tab, title: firstLine } : tab
          ));
        }
      }
      
      await Meteor.callAsync('notes.update', noteId, updateData);
      
      // Clean localStorage after successful save
      localStorage.removeItem(`note-content-${noteId}`);
      setTouchedNotes(prev => { const n = new Set(prev); n.delete(noteId); return n; });

      // Update baseline content so the tab is no longer dirty
      setOpenTabs(prev => prev.map(tab => tab.id === noteId ? { ...tab, note: { ...(tab.note || {}), content: noteContents[noteId] } } : tab));
    } catch (error) {
      console.error('Error saving note:', error);
      notify({ message: 'Error saving note', kind: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Update note content
  const updateNoteContent = (noteId, content) => {
    setNoteContents(prev => ({
      ...prev,
      [noteId]: content
    }));
    setTouchedNotes(prev => new Set([...prev, noteId]));
  };

  // Save all open notes
  const saveAllNotes = async () => {
    for (const tab of openTabs) {
      await saveNote(tab.id);
    }
  };

  // Delete a note (DB + UI cleanup)
  const deleteNote = async (noteId) => {
    try {
      await Meteor.callAsync('notes.remove', noteId);
      // Remove local unsaved content
      localStorage.removeItem(`note-content-${noteId}`);
      setTouchedNotes(prev => { const n = new Set(prev); n.delete(noteId); return n; });
      // Close the tab if open
      closeTab(noteId);
    } catch (error) {
      console.error('Error deleting note:', error);
      notify({ message: 'Error deleting note', kind: 'error' });
    }
  };

  // Reorder tabs
  const handleTabsReorder = (nextOrder) => {
    setOpenTabs((prev) => {
      const map = new Map(prev.map(t => [t.id, t]));
      const reordered = nextOrder.map(id => map.get(id)).filter(Boolean);
      // keep any tabs that might be missing (safety)
      const missing = prev.filter(t => !nextOrder.includes(t.id));
      const next = [...reordered, ...missing];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('notes-open-tabs', JSON.stringify(next));
      }
      return next;
    });
  };

  // Close all tabs except one
  const closeOtherTabs = (tabId) => {
    const otherIds = openTabs.filter(t => t.id !== tabId).map(t => t.id);
    otherIds.forEach(id => localStorage.removeItem(`note-content-${id}`));
    setOpenTabs(prev => prev.filter(t => t.id === tabId));
    setNoteContents(prev => ({ [tabId]: prev[tabId] }));
    setActiveTabId(tabId);
  };

  // Close all tabs
  const closeAllTabs = () => {
    openTabs.forEach(t => localStorage.removeItem(`note-content-${t.id}`));
    setOpenTabs([]);
    setNoteContents({});
    setActiveTabId(null);
  };

  // Rename a tab
  const handleTabRename = async (tabId, newTitle) => {
    try {
      // Update the note title in the database
      await Meteor.callAsync('notes.update', tabId, {
        title: newTitle
      });
      
      // Update the tab title locally
      setOpenTabs(prev => prev.map(tab => 
        tab.id === tabId ? { ...tab, title: newTitle } : tab
      ));
      
      // Mark this tab as manually renamed
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
      console.error('Error moving note:', error);
      notify({ message: 'Error moving note', kind: 'error' });
    }
  };

  const handleDuplicateNote = async (noteId) => {
    try {
      const newNoteId = await Meteor.callAsync('notes.duplicate', noteId);
      const newNote = notesById.get(newNoteId);
      if (newNote) {
        openNote(newNote);
        notify({ message: 'Note duplicated successfully', kind: 'success' });
      }
    } catch (error) {
      console.error('Error duplicating note:', error);
      notify({ message: 'Error duplicating note', kind: 'error' });
    }
  };

  const handleCreateNote = async () => {
    if (isCreatingNote) return; // Prevent multiple simultaneous calls
    
    setIsCreatingNote(true);
    try {
      const newNoteId = await Meteor.callAsync('notes.insert', { 
        title: 'New note',
        content: ''
      });
      
      if (!newNoteId) {
        throw new Error('No ID returned from notes.insert');
      }
      
      // Create note object directly since notesById might not be updated yet
      const newNote = {
        _id: newNoteId,
        title: 'New note',
        content: '',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      openNote(newNote, true); // true = shouldFocus
      notify({ message: 'New note created', kind: 'success' });
    } catch (error) {
      console.error('Error creating note:', error);
      notify({ message: 'Error creating note', kind: 'error' });
    } finally {
      setIsCreatingNote(false);
    }
  };

  // Effect to handle URL parameter for opening specific note
  useEffect(() => {
    const route = parseHashRoute();
    if (route.name === 'notes' && route.noteId) {
      const note = notesById.get(route.noteId);
      if (note && !openTabs.find(tab => tab.id === note._id)) {
        // Open the note with focus
        openNote(note, true);
      }
    }
  }, [notesById, openTabs]);

  return (
    <div className="notes-page">
      <div className="notes-sidebar">
        <NotesSearch 
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
        
        <NotesList
          notes={notes}
          filteredNotes={filteredNotes}
          openTabs={openTabs}
          activeTabId={activeTabId}
          projectNamesById={projectNamesById}
          onNoteClick={openNote}
          onRequestClose={closeTab}
        />
      </div>

      <div className="notes-editor">
        {openTabs.length > 0 ? (
          <>
            <NotesTabs
              openTabs={openTabs}
              activeTabId={activeTabId}
              onTabClick={setActiveTabId}
              onTabClose={closeTab}
              onTabRename={handleTabRename}
              onTabsReorder={handleTabsReorder}
              dirtySet={dirtySet}
              onTabDelete={deleteNote}
              onCloseOthers={closeOtherTabs}
              onCloseAll={closeAllTabs}
              onCreateNote={handleCreateNote}
              isCreatingNote={isCreatingNote}
            />
            
            <div className="notes-content">
              <NoteEditor
                activeTabId={activeTabId}
                noteContents={noteContents}
                onContentChange={updateNoteContent}
                onSave={saveNote}
                onSaveAll={saveAllNotes}
                onClose={closeTab}
                isSaving={isSaving}
                activeNote={activeTabId ? (notesById.get(activeTabId) || openTabs.find(tab => tab.id === activeTabId)?.note) : null}
                projectOptions={projectOptions}
                onMoveProject={handleMoveProject}
                onDuplicate={handleDuplicateNote}
                shouldFocus={shouldFocusNote === activeTabId}
                dirtySet={dirtySet}
              />
            </div>
          </>
        ) : (
          <div className="notes-empty">
            <h2>Notes</h2>
            <p>Select a note from the list to start editing</p>
          </div>
        )}
      </div>
    </div>
  );
};
