import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { ProjectList } from './ProjectList.jsx';
import { SessionView } from './SessionView.jsx';
import { NotePanel } from './NotePanel.jsx';
import { useHomeDir } from './useHomeDir.js';
import { notify } from '/imports/ui/utils/notify.js';
import { navigateTo } from '/imports/ui/router.js';
import './ClaudeCodePage.css';

const STORAGE_KEY = 'claude-activePanel';
const PROJECT_STORAGE_KEY = 'claude-activeProject';
const NOTE_STORAGE_KEY = 'claude-openNote';

const serializePanel = (panel) => panel ? JSON.stringify(panel) : null;
const deserializePanel = (str) => {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
};

export const ClaudeCodePage = ({ projectId }) => {
  const homeDir = useHomeDir();
  const [activePanel, setActivePanel] = useState(null); // { type: 'session', id: string }
  const [openNoteId, setOpenNoteId] = useState(null);
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

  // Subscribe to sessions and notes for the active project
  useSubscribe('claudeSessions.byProject', projectId || '__none__');
  useSubscribe('notes.byClaudeProject', projectId || '__none__');

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

  // Validate activePanel: if the referenced session no longer exists, fallback
  useEffect(() => {
    if (!activePanel) return;
    if (!sessions.find(s => s._id === activePanel.id)) {
      setActivePanel(sessions.length > 0 ? { type: 'session', id: sessions[0]._id } : null);
    }
  }, [sessions, activePanel]);

  // Validate openNoteId: if the note no longer exists, close sidebar
  useEffect(() => {
    if (!openNoteId) return;
    if (!notes.find(n => n._id === openNoteId)) {
      setOpenNoteId(null);
    }
  }, [notes, openNoteId]);

  // Restore active panel and note sidebar from localStorage
  useEffect(() => {
    if (!projectId) {
      setActivePanel(null);
      setOpenNoteId(null);
      restoredForProject.current = null;
      return;
    }
    if (sessions.length === 0) return;
    if (restoredForProject.current === projectId) return;

    const saved = deserializePanel(localStorage.getItem(`${STORAGE_KEY}-${projectId}`));
    const savedNoteId = localStorage.getItem(`${NOTE_STORAGE_KEY}-${projectId}`);

    // Wait for notes if we need them for restore
    if ((saved?.type === 'note' || savedNoteId) && notes.length === 0) return;

    restoredForProject.current = projectId;

    // Restore session focus
    if (saved?.type === 'session' && sessions.find(s => s._id === saved.id)) {
      setActivePanel(saved);
    } else {
      setActivePanel({ type: 'session', id: sessions[0]._id });
    }

    // Restore note sidebar (new format takes precedence over backward compat)
    if (savedNoteId && notes.find(n => n._id === savedNoteId)) {
      setOpenNoteId(savedNoteId);
    } else if (saved?.type === 'note' && notes.find(n => n._id === saved.id)) {
      // Backward compat: migrate from old activePanel format
      setOpenNoteId(saved.id);
    }
  }, [projectId, sessions, notes]);

  // Persist active panel to localStorage
  useEffect(() => {
    if (projectId && activePanel) {
      localStorage.setItem(`${STORAGE_KEY}-${projectId}`, serializePanel(activePanel));
    }
  }, [projectId, activePanel]);

  // Persist open note sidebar to localStorage (only after restore is complete)
  useEffect(() => {
    if (projectId && restoredForProject.current === projectId) {
      if (openNoteId) {
        localStorage.setItem(`${NOTE_STORAGE_KEY}-${projectId}`, openNoteId);
      } else {
        localStorage.removeItem(`${NOTE_STORAGE_KEY}-${projectId}`);
      }
    }
  }, [projectId, openNoteId]);

  // Jump to session from Cmd+Shift+C shortcut
  useEffect(() => {
    const targetId = localStorage.getItem('claude-jumpToSession');
    if (!targetId || sessions.length === 0) return;
    if (sessions.find(s => s._id === targetId)) {
      setActivePanel({ type: 'session', id: targetId });
    }
    localStorage.removeItem('claude-jumpToSession');
  }, [sessions]);

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
            // Switch to the nearest session (prefer previous, fallback to next)
            const nextIdx = Math.min(idx, remaining.length - 1);
            setActivePanel(remaining.length > 0 ? { type: 'session', id: remaining[nextIdx]._id } : null);
          });
          return;
        }
        // Single session: close note sidebar if open
        if (openNoteId) {
          setOpenNoteId(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, activePanel, openNoteId, sessions]);

  const handleCreateNote = () => {
    if (!projectId) return;
    Meteor.call('notes.insert', { title: 'New note', claudeProjectId: projectId, content: '' }, (err, newId) => {
      if (err) {
        notify({ message: `Create note failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setOpenNoteId(newId);
    });
  };

  const activePanelIdx = activePanel?.type === 'session'
    ? sessions.findIndex(s => s._id === activePanel.id)
    : -1;

  // Scroll active panel into view when tab is clicked (especially when note sidebar is open)
  useEffect(() => {
    if (activePanelIdx >= 0 && panelRefs.current[activePanelIdx]) {
      panelRefs.current[activePanelIdx].scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [activePanelIdx]);

  return (
    <div className="ccPage">
      <ProjectList
        activeProjectId={projectId}
        homeDir={homeDir}
        activePanel={activePanel}
        openNoteId={openNoteId}
        onPanelClick={(panel) => setActivePanel(panel)}
        onNoteToggle={(noteId) => setOpenNoteId(openNoteId === noteId ? null : noteId)}
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
                onClick={() => setActivePanel({ type: 'session', id: session._id })}
              >
                {session.name}
                <span className={`ccTabStatus ccStatus-${session.unseenCompleted ? 'completed' : session.status}`} />
              </button>
            ))}
            {notes.map((note) => (
              <button
                key={note._id}
                className={`ccSessionTab ccNoteTab ${openNoteId === note._id ? 'ccSessionTabActive' : ''}`}
                onClick={() => setOpenNoteId(openNoteId === note._id ? null : note._id)}
              >
                <span className="ccNoteTabIcon">N</span>
                {note.title || 'Untitled'}
              </button>
            ))}
            <button className="ccSessionTab ccNewNoteTab" onClick={handleCreateNote} title="New note">
              + Note
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
                  onClick={() => setActivePanel({ type: 'session', id: session._id })}
                >
                  <SessionView
                    sessionId={session._id}
                    homeDir={homeDir}
                    isActive={idx === activePanelIdx}
                    onFocus={() => setActivePanel({ type: 'session', id: session._id })}
                    onNewSession={(newId) => setActivePanel({ type: 'session', id: newId })}
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
          {openNoteId && (
            <>
              <div className="ccPanelDivider" />
              <div className="ccNoteSidebar">
                <NotePanel key={openNoteId} noteId={openNoteId} claudeProjectId={projectId} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
