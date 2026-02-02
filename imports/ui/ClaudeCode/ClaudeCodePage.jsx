import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { ClaudeProjectsCollection } from '/imports/api/claudeProjects/collections';
import { ProjectList } from './ProjectList.jsx';
import { SessionView } from './SessionView.jsx';
import { NotePanel } from './NotePanel.jsx';
import { DiskFileEditor } from '/imports/ui/components/DiskFileEditor/DiskFileEditor.jsx';
import { useHomeDir } from './useHomeDir.js';
import { notify } from '/imports/ui/utils/notify.js';
import { navigateTo } from '/imports/ui/router.js';
import './ClaudeCodePage.css';

const STORAGE_KEY = 'claude-activePanel';
const PROJECT_STORAGE_KEY = 'claude-activeProject';
const SIDEBAR_STORAGE_KEY = 'claude-sidebar';
const ACTIVE_SIDEBAR_STORAGE_KEY = 'claude-activeSidebar';

const serializePanel = (panel) => panel ? JSON.stringify(panel) : null;
const deserializePanel = (str) => {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
};

const parseJson = (str, fallback) => {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
};

// Sidebar item helpers
const isFileItem = (id) => id?.startsWith('file:');
const filePathFromId = (id) => id?.slice(5);
const fileIdFromPath = (path) => `file:${path}`;
const itemLabel = (id, notes) => {
  if (isFileItem(id)) return filePathFromId(id).split('/').pop();
  const note = notes.find(n => n._id === id);
  return note?.title || 'Untitled';
};

export const ClaudeCodePage = ({ projectId }) => {
  const homeDir = useHomeDir();
  const [activePanel, setActivePanel] = useState(null); // { type: 'session', id: string }
  // Sidebar: multiple items open, one active
  const [sidebarItems, setSidebarItems] = useState([]); // array of IDs (noteId or 'file:/path')
  const [activeSidebarId, setActiveSidebarId] = useState(null);
  const [lastFocus, setLastFocus] = useState('session'); // 'session' | 'sidebar'
  const panelRefs = useRef([]);
  const restoredForProject = useRef(null);

  // Redirect to last active project if none in URL
  useEffect(() => {
    if (projectId) {
      localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    } else {
      const savedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
      if (savedProjectId) {
        navigateTo({ name: 'claude', projectId: savedProjectId });
      }
    }
  }, [projectId]);

  // Subscribe to sessions, notes, and projects
  useSubscribe('claudeSessions.byProject', projectId || '__none__');
  useSubscribe('notes.byClaudeProject', projectId || '__none__');
  useSubscribe('claudeProjects');

  // Sessions (reactive)
  const sessions = useFind(() =>
    ClaudeSessionsCollection.find(
      projectId ? { projectId } : { projectId: '__none__' },
      { sort: { createdAt: 1 } }
    ),
    [projectId]
  );

  // Notes linked to this claude project (reactive)
  const notes = useFind(() =>
    NotesCollection.find(
      projectId ? { claudeProjectId: projectId } : { claudeProjectId: '__none__' },
      { sort: { createdAt: 1 } }
    ),
    [projectId]
  );

  // Active project (for cwd in file browser)
  const activeProject = useFind(() =>
    ClaudeProjectsCollection.find(
      projectId ? { _id: projectId } : { _id: '__none__' }
    ),
    [projectId]
  )[0];

  // Validate activePanel: if the referenced session no longer exists, fallback
  useEffect(() => {
    if (!activePanel) return;
    if (!sessions.find(s => s._id === activePanel.id)) {
      setActivePanel(sessions.length > 0 ? { type: 'session', id: sessions[0]._id } : null);
    }
  }, [sessions, activePanel]);

  // Validate sidebar items: remove note IDs that no longer exist
  useEffect(() => {
    if (sidebarItems.length === 0) return;
    const validItems = sidebarItems.filter(id => {
      if (isFileItem(id)) return true; // files don't need validation against notes
      return notes.find(n => n._id === id);
    });
    if (validItems.length !== sidebarItems.length) {
      setSidebarItems(validItems);
      if (activeSidebarId && !validItems.includes(activeSidebarId)) {
        setActiveSidebarId(validItems.length > 0 ? validItems[validItems.length - 1] : null);
      }
    }
  }, [notes, sidebarItems, activeSidebarId]);

  // Restore active panel and sidebar from localStorage
  useEffect(() => {
    if (!projectId) {
      setActivePanel(null);
      setSidebarItems([]);
      setActiveSidebarId(null);
      restoredForProject.current = null;
      return;
    }
    if (sessions.length === 0) return;
    if (restoredForProject.current === projectId) return;

    const saved = deserializePanel(localStorage.getItem(`${STORAGE_KEY}-${projectId}`));

    // Restore sidebar items
    const savedSidebar = parseJson(localStorage.getItem(`${SIDEBAR_STORAGE_KEY}-${projectId}`), []);
    const savedActive = localStorage.getItem(`${ACTIVE_SIDEBAR_STORAGE_KEY}-${projectId}`);

    // Backward compat: migrate from old single-note format
    const oldNoteId = localStorage.getItem(`claude-openNote-${projectId}`);

    // Wait for notes if we have note-based sidebar items to restore
    const hasNoteItems = savedSidebar.some(id => !isFileItem(id)) || oldNoteId;
    if (hasNoteItems && notes.length === 0) return;

    restoredForProject.current = projectId;

    // Restore session focus
    if (saved?.type === 'session' && sessions.find(s => s._id === saved.id)) {
      setActivePanel(saved);
    } else {
      setActivePanel({ type: 'session', id: sessions[0]._id });
    }

    // Restore sidebar
    if (savedSidebar.length > 0) {
      // Filter valid note IDs
      const validItems = savedSidebar.filter(id => {
        if (isFileItem(id)) return true;
        return notes.find(n => n._id === id);
      });
      setSidebarItems(validItems);
      if (savedActive && validItems.includes(savedActive)) {
        setActiveSidebarId(savedActive);
      } else if (validItems.length > 0) {
        setActiveSidebarId(validItems[0]);
      }
    } else if (oldNoteId && notes.find(n => n._id === oldNoteId)) {
      // Backward compat: migrate single note
      setSidebarItems([oldNoteId]);
      setActiveSidebarId(oldNoteId);
      localStorage.removeItem(`claude-openNote-${projectId}`);
    } else if (saved?.type === 'note' && notes.find(n => n._id === saved.id)) {
      // Backward compat: migrate from old activePanel format
      setSidebarItems([saved.id]);
      setActiveSidebarId(saved.id);
    }
  }, [projectId, sessions, notes]);

  // Persist active panel to localStorage
  useEffect(() => {
    if (projectId && activePanel) {
      localStorage.setItem(`${STORAGE_KEY}-${projectId}`, serializePanel(activePanel));
    }
  }, [projectId, activePanel]);

  // Persist sidebar state to localStorage (only after restore is complete)
  useEffect(() => {
    if (projectId && restoredForProject.current === projectId) {
      if (sidebarItems.length > 0) {
        localStorage.setItem(`${SIDEBAR_STORAGE_KEY}-${projectId}`, JSON.stringify(sidebarItems));
      } else {
        localStorage.removeItem(`${SIDEBAR_STORAGE_KEY}-${projectId}`);
      }
      if (activeSidebarId) {
        localStorage.setItem(`${ACTIVE_SIDEBAR_STORAGE_KEY}-${projectId}`, activeSidebarId);
      } else {
        localStorage.removeItem(`${ACTIVE_SIDEBAR_STORAGE_KEY}-${projectId}`);
      }
    }
  }, [projectId, sidebarItems, activeSidebarId]);

  // Jump to session from Cmd+Shift+C shortcut
  useEffect(() => {
    const targetId = localStorage.getItem('claude-jumpToSession');
    if (!targetId || sessions.length === 0) return;
    if (sessions.find(s => s._id === targetId)) {
      setActivePanel({ type: 'session', id: targetId });
    }
    localStorage.removeItem('claude-jumpToSession');
  }, [sessions]);

  // Sidebar helpers
  const openInSidebar = useCallback((id) => {
    setSidebarItems(prev => prev.includes(id) ? prev : [...prev, id]);
    setActiveSidebarId(id);
    setLastFocus('sidebar');
  }, []);

  const closeFromSidebar = useCallback((id) => {
    setSidebarItems(prev => {
      const next = prev.filter(i => i !== id);
      // If closing the active item, switch to next
      if (activeSidebarId === id) {
        const idx = prev.indexOf(id);
        const fallback = next.length > 0 ? next[Math.min(idx, next.length - 1)] : null;
        setActiveSidebarId(fallback);
      }
      return next;
    });
  }, [activeSidebarId]);

  const toggleInSidebar = useCallback((id) => {
    if (sidebarItems.includes(id)) {
      if (activeSidebarId === id) {
        // Already active: close it
        closeFromSidebar(id);
      } else {
        // In sidebar but not active: make it active
        setActiveSidebarId(id);
        setLastFocus('sidebar');
      }
    } else {
      // Not in sidebar: add and activate
      openInSidebar(id);
    }
  }, [sidebarItems, activeSidebarId, openInSidebar, closeFromSidebar]);

  // Keyboard shortcuts: Cmd-D (new session / split), Cmd-W (close/deselect)
  useEffect(() => {
    if (!projectId) return;
    const handler = (e) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        Meteor.call('claudeSessions.createInProject', projectId, (err, newId) => {
          if (err) {
            notify({ message: `Split failed: ${err.reason || err.message}`, kind: 'error' });
            return;
          }
          setActivePanel({ type: 'session', id: newId });
        });
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        // Close whatever has focus: sidebar item or session
        if (lastFocus === 'sidebar' && activeSidebarId) {
          closeFromSidebar(activeSidebarId);
          return;
        }
        // Close the active (focused) session
        if (sessions.length > 1 && activePanel?.type === 'session') {
          const idx = sessions.findIndex(s => s._id === activePanel.id);
          if (idx === -1) return;
          const sessionToRemove = sessions[idx];
          Meteor.call('claudeSessions.remove', sessionToRemove._id, (err) => {
            if (err) {
              notify({ message: `Close failed: ${err.reason || err.message}`, kind: 'error' });
              return;
            }
            const remaining = sessions.filter(s => s._id !== sessionToRemove._id);
            const nextIdx = Math.min(idx, remaining.length - 1);
            setActivePanel(remaining.length > 0 ? { type: 'session', id: remaining[nextIdx]._id } : null);
          });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, activePanel, activeSidebarId, lastFocus, sessions, closeFromSidebar]);

  const handleCreateNote = () => {
    if (!projectId) return;
    Meteor.call('notes.insert', { title: 'New note', claudeProjectId: projectId, content: '' }, (err, newId) => {
      if (err) {
        notify({ message: `Create note failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      openInSidebar(newId);
    });
  };

  const handleOpenFile = async () => {
    if (!window.electron?.openFileDialog) {
      notify({ message: 'File dialog only available in Electron', kind: 'error' });
      return;
    }
    const filePath = await window.electron.openFileDialog({ defaultPath: activeProject?.cwd });
    if (!filePath) return;
    openInSidebar(fileIdFromPath(filePath));
  };

  const activePanelIdx = activePanel?.type === 'session'
    ? sessions.findIndex(s => s._id === activePanel.id)
    : -1;

  // Scroll active panel into view when tab is clicked
  useEffect(() => {
    if (activePanelIdx >= 0 && panelRefs.current[activePanelIdx]) {
      panelRefs.current[activePanelIdx].scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [activePanelIdx]);

  const hasSidebar = sidebarItems.length > 0;

  return (
    <div className="ccPage">
      <ProjectList
        activeProjectId={projectId}
        homeDir={homeDir}
        activePanel={activePanel}
        sidebarItems={sidebarItems}
        activeSidebarId={activeSidebarId}
        onPanelClick={(panel) => { setActivePanel(panel); setLastFocus('session'); }}
        onSidebarToggle={toggleInSidebar}
      />
      <div className="ccMain">
        {!projectId && (
          <div className="ccSessionViewEmpty">
            <p className="muted">Select or create a project to start.</p>
          </div>
        )}
        {projectId && sessions.length === 0 && notes.length === 0 && (
          <div className="ccSessionViewEmpty">
            <p className="muted">Loading sessions...</p>
          </div>
        )}
        {(sessions.length > 0 || notes.length > 0) && (
          <div className="ccSessionTabs">
            {sessions.map((session) => (
              <button
                key={session._id}
                className={`ccSessionTab ${activePanel?.type === 'session' && activePanel.id === session._id ? 'ccSessionTabActive' : ''}`}
                onClick={() => { setActivePanel({ type: 'session', id: session._id }); setLastFocus('session'); }}
              >
                {session.name}
                <span className={`ccTabStatus ccStatus-${session.unseenCompleted ? 'completed' : session.status}`} />
              </button>
            ))}
            {notes.map((note) => (
              <button
                key={note._id}
                className={`ccSessionTab ccNoteTab ${sidebarItems.includes(note._id) ? 'ccSessionTabActive' : ''}`}
                onClick={() => toggleInSidebar(note._id)}
              >
                <span className="ccNoteTabIcon">N</span>
                {note.title || 'Untitled'}
              </button>
            ))}
            {sidebarItems.filter(isFileItem).map((id) => (
              <button
                key={id}
                className={`ccSessionTab ccFileTab ${activeSidebarId === id ? 'ccSessionTabActive' : ''}`}
                onClick={() => { setActiveSidebarId(id); setLastFocus('sidebar'); }}
                title={filePathFromId(id)}
              >
                <span className="ccFileTabIcon">F</span>
                {filePathFromId(id).split('/').pop()}
              </button>
            ))}
            <button className="ccSessionTab ccNewNoteTab" onClick={handleCreateNote} title="New note">
              + Note
            </button>
            <button className="ccSessionTab ccNewNoteTab" onClick={handleOpenFile} title="Open file">
              + File
            </button>
          </div>
        )}
        <div className="ccPanels">
          <div className="ccSessionsPanels">
            {sessions.map((session, idx) => (
              <React.Fragment key={session._id}>
                {idx > 0 && <div className="ccPanelDivider" />}
                <div
                  className={`ccPanel ${idx === activePanelIdx ? 'ccPanelActive' : ''}`}
                  ref={el => panelRefs.current[idx] = el}
                  onClick={() => { setActivePanel({ type: 'session', id: session._id }); setLastFocus('session'); }}
                >
                  <SessionView
                    sessionId={session._id}
                    homeDir={homeDir}
                    isActive={idx === activePanelIdx}
                    onFocus={() => { setActivePanel({ type: 'session', id: session._id }); setLastFocus('session'); }}
                    onNewSession={(newId) => setActivePanel({ type: 'session', id: newId })}
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
          {hasSidebar && (
            <>
              <div className="ccPanelDivider" />
              <div className="ccNoteSidebar">
                {sidebarItems.length > 1 && (
                  <div className="ccSidebarTabs">
                    {sidebarItems.map((id) => (
                      <div
                        key={id}
                        className={`ccSidebarTab ${activeSidebarId === id ? 'ccSidebarTabActive' : ''}`}
                        onClick={() => { setActiveSidebarId(id); setLastFocus('sidebar'); }}
                        title={isFileItem(id) ? filePathFromId(id) : undefined}
                      >
                        <span className={isFileItem(id) ? 'ccFileTabIcon' : 'ccNoteTabIcon'}>
                          {isFileItem(id) ? 'F' : 'N'}
                        </span>
                        <span className="ccSidebarTabLabel">{itemLabel(id, notes)}</span>
                        <button
                          className="ccSidebarTabClose"
                          onClick={(e) => { e.stopPropagation(); closeFromSidebar(id); }}
                          type="button"
                        >&times;</button>
                      </div>
                    ))}
                  </div>
                )}
                {activeSidebarId && !isFileItem(activeSidebarId) && (
                  <NotePanel key={activeSidebarId} noteId={activeSidebarId} claudeProjectId={projectId} />
                )}
                {activeSidebarId && isFileItem(activeSidebarId) && (
                  <DiskFileEditor
                    key={activeSidebarId}
                    filePath={filePathFromId(activeSidebarId)}
                    onClose={() => closeFromSidebar(activeSidebarId)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
};
