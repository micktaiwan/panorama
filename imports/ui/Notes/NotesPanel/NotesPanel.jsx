import React, { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { NotesCollection } from '/imports/api/notes/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { useNoteTabs } from '../hooks/useNoteTabs.js';
import { NotesSearch } from '../components/NotesSearch.jsx';
import { NotesList } from '../components/NotesList.jsx';
import { NotesTabs } from '../components/NotesTabs.jsx';
import { NoteEditor } from '../components/NoteEditor.jsx';
import { DiskFileEditor } from '/imports/ui/components/DiskFileEditor/DiskFileEditor.jsx';
import './NotesPanel.css';

export const NotesPanel = forwardRef(({
  projectId,
  storageKey = null,
  showFileOpen = false,
  showProjectColumn = true,
  showMoveProject = true,
  className,
  onDirtyCountChange,
  onTabClosed,
}, ref) => {
  // ---- Subscriptions & data ----
  const notes = useTracker(() => {
    Meteor.subscribe('notes');
    const selector = projectId ? { projectId } : {};
    return NotesCollection.find(selector, { sort: { updatedAt: -1, createdAt: -1 } }).fetch();
  }, [projectId]);

  const notesById = useMemo(() => {
    const map = new Map();
    for (const n of notes) map.set(n._id, n);
    return map;
  }, [notes]);

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

  // ---- Network users (for lock display) ----
  const networkUsers = useTracker(() => {
    Meteor.subscribe('users.network');
    return Meteor.users.find({}, { fields: { 'profile.name': 1 } }).fetch();
  });

  const lockedByNames = useMemo(() => {
    const map = {};
    networkUsers.forEach(u => { map[u._id] = u.profile?.name || 'Unknown'; });
    return map;
  }, [networkUsers]);

  // ---- Hook ----
  const tabs = useNoteTabs({
    notes,
    notesById,
    storageKey,
    defaultProjectId: projectId || null,
  });

  const {
    searchTerm, setSearchTerm,
    openTabs, activeTabId, setActiveTabId,
    noteContents, isSaving, shouldFocusNote,
    isCreatingNote, showOnlyOpen, setShowOnlyOpen,
    filteredNotes, dirtySet,
    openNote, closeTab, openFile,
    saveNote, saveAllNotes, updateNoteContent, deleteNote,
    handleTabsReorder, handleTabRename,
    closeOtherTabs, closeAllTabs,
    handleMoveProject, handleDuplicateNote, handleReorderNote,
    handleCreateNote,
  } = tabs;

  // ---- Notify parent of dirty count changes ----
  const prevDirtyCountRef = useRef(dirtySet.size);
  useEffect(() => {
    if (onDirtyCountChange && dirtySet.size !== prevDirtyCountRef.current) {
      prevDirtyCountRef.current = dirtySet.size;
      onDirtyCountChange(dirtySet.size);
    }
  }, [dirtySet.size, onDirtyCountChange]);

  // ---- Wrap closeTab to call onTabClosed callback ----
  const handleCloseTab = (tabId) => {
    closeTab(tabId);
    onTabClosed?.(tabId);
  };

  // ---- Cmd/Ctrl + W → close active tab ----
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'w' && activeTabId) {
        e.preventDefault();
        handleCloseTab(activeTabId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, openTabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Imperative handle with pending open queue ----
  const pendingOpenRef = useRef(null);

  useImperativeHandle(ref, () => ({
    openNote(noteId) {
      const note = notesById.get(noteId);
      if (note) {
        openNote(note, true);
        pendingOpenRef.current = null;
      } else {
        // Note not loaded yet — queue for when notesById updates
        pendingOpenRef.current = noteId;
      }
    },
    get dirtyCount() {
      return dirtySet.size;
    },
  }), [notesById, dirtySet.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fulfill pending open when notes data arrives
  useEffect(() => {
    if (pendingOpenRef.current) {
      const note = notesById.get(pendingOpenRef.current);
      if (note) {
        openNote(note, true);
        pendingOpenRef.current = null;
      }
    }
  }, [notesById]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Render ----
  const activeTab = openTabs.find(t => t.id === activeTabId);
  const isFileTab = activeTab?.type === 'file';
  const handleBackToList = () => setActiveTabId(null);

  // Compute lockedByName for the active note
  const activeNoteData = activeTabId ? (notesById.get(activeTabId) || openTabs.find(tab => tab.id === activeTabId)?.note) : null;
  // Compute lock state per tab for tab bar display
  const lockedTabs = useMemo(() => {
    const myId = Meteor.userId();
    const map = {};
    for (const tab of openTabs) {
      if (tab.type === 'file') continue;
      const note = notesById.get(tab.id);
      if (note?.lockedBy) {
        map[tab.id] = {
          self: note.lockedBy === myId,
          name: lockedByNames[note.lockedBy] || 'another user',
        };
      }
    }
    return map;
  }, [openTabs, notesById, lockedByNames]);

  return (
    <div className={`notes-panel${activeTabId ? ' mobile-editor-active' : ''}${className ? ` ${className}` : ''}`}>
      <div className="notes-sidebar">
        <NotesSearch
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          showOnlyOpen={showOnlyOpen}
          onShowOnlyOpenChange={setShowOnlyOpen}
        />
        <button
          className="sidebar-new-note-btn"
          onClick={handleCreateNote}
          disabled={isCreatingNote}
          type="button"
        >
          {isCreatingNote ? 'Creating...' : '+ New note'}
        </button>
        <NotesList
          notes={notes}
          filteredNotes={filteredNotes}
          openTabs={openTabs}
          activeTabId={activeTabId}
          projectNamesById={showProjectColumn ? projectNamesById : undefined}
          lockedByNames={lockedByNames}
          onNoteClick={openNote}
          onRequestClose={handleCloseTab}
          onReorderNote={handleReorderNote}
        />
      </div>

      <div className="notes-editor">
        {openTabs.length > 0 ? (
          <>
            <NotesTabs
              openTabs={openTabs}
              activeTabId={activeTabId}
              onTabClick={setActiveTabId}
              onTabClose={handleCloseTab}
              onTabRename={handleTabRename}
              onTabsReorder={handleTabsReorder}
              dirtySet={dirtySet}
              lockedTabs={lockedTabs}
              onTabDelete={deleteNote}
              onCloseOthers={closeOtherTabs}
              onCloseAll={closeAllTabs}
              onCreateNote={handleCreateNote}
              isCreatingNote={isCreatingNote}
              onOpenFile={showFileOpen ? openFile : undefined}
              onBackToList={handleBackToList}
            />
            <div className="notes-content">
              {isFileTab ? (
                <DiskFileEditor
                  key={activeTab.filePath}
                  filePath={activeTab.filePath}
                  onClose={() => handleCloseTab(activeTabId)}
                />
              ) : (
                <NoteEditor
                  activeTabId={activeTabId}
                  noteContents={noteContents}
                  onContentChange={updateNoteContent}
                  onSave={saveNote}
                  onSaveAll={saveAllNotes}
                  onClose={handleCloseTab}
                  isSaving={isSaving}
                  activeNote={activeNoteData}
                  projectOptions={showMoveProject ? projectOptions : []}
                  onMoveProject={showMoveProject ? handleMoveProject : undefined}
                  onDuplicate={handleDuplicateNote}
                  shouldFocus={shouldFocusNote === activeTabId}
                  dirtySet={dirtySet}
                />
              )}
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
});

NotesPanel.displayName = 'NotesPanel';

NotesPanel.propTypes = {
  projectId: PropTypes.string,
  storageKey: PropTypes.string,
  showFileOpen: PropTypes.bool,
  showProjectColumn: PropTypes.bool,
  showMoveProject: PropTypes.bool,
  className: PropTypes.string,
  onDirtyCountChange: PropTypes.func,
  onTabClosed: PropTypes.func,
};
