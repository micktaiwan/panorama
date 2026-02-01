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

const serializePanel = (panel) => panel ? JSON.stringify(panel) : null;
const deserializePanel = (str) => {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
};

export const ClaudeCodePage = ({ projectId }) => {
  const homeDir = useHomeDir();
  const [activePanel, setActivePanel] = useState(null); // { type: 'session'|'note', id: string }
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

  // Validate activePanel: if the referenced item no longer exists, fallback
  useEffect(() => {
    if (!activePanel) return;
    if (activePanel.type === 'session') {
      if (!sessions.find(s => s._id === activePanel.id)) {
        // Session gone — fallback to first session
        setActivePanel(sessions.length > 0 ? { type: 'session', id: sessions[0]._id } : null);
      }
    } else if (activePanel.type === 'note') {
      if (!notes.find(n => n._id === activePanel.id)) {
        // Note gone — fallback to first session
        setActivePanel(sessions.length > 0 ? { type: 'session', id: sessions[0]._id } : null);
      }
    }
  }, [sessions, notes, activePanel]);

  // Restore active panel from localStorage when project changes or sessions load
  useEffect(() => {
    if (!projectId) {
      setActivePanel(null);
      restoredForProject.current = null;
      return;
    }
    if (sessions.length === 0) return;
    if (restoredForProject.current === projectId) return;

    restoredForProject.current = projectId;
    const saved = deserializePanel(localStorage.getItem(`${STORAGE_KEY}-${projectId}`));
    if (saved) {
      // Verify the saved item still exists
      if (saved.type === 'session' && sessions.find(s => s._id === saved.id)) {
        setActivePanel(saved);
        return;
      }
      if (saved.type === 'note' && notes.find(n => n._id === saved.id)) {
        setActivePanel(saved);
        return;
      }
    }
    // Default to first session
    setActivePanel({ type: 'session', id: sessions[0]._id });
  }, [projectId, sessions, notes]);

  // Persist active panel to localStorage
  useEffect(() => {
    if (projectId && activePanel) {
      localStorage.setItem(`${STORAGE_KEY}-${projectId}`, serializePanel(activePanel));
    }
  }, [projectId, activePanel]);

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
        // If a note is active, just go back to first session (don't delete)
        if (activePanel?.type === 'note') {
          if (sessions.length > 0) {
            setActivePanel({ type: 'session', id: sessions[0]._id });
          }
          return;
        }
        // If a session is active, remove it (if more than one)
        if (sessions.length <= 1) return;
        const sessionToRemove = sessions.find(s => s._id === activePanel?.id);
        if (!sessionToRemove) return;
        Meteor.call('claudeSessions.remove', sessionToRemove._id, (err) => {
          if (err) {
            notify({ message: `Close failed: ${err.reason || err.message}`, kind: 'error' });
            return;
          }
          // Fallback to first remaining session
          const remaining = sessions.filter(s => s._id !== sessionToRemove._id);
          setActivePanel(remaining.length > 0 ? { type: 'session', id: remaining[0]._id } : null);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, activePanel, sessions]);

  const handleCreateNote = () => {
    if (!projectId) return;
    Meteor.call('notes.insert', { title: 'New note', claudeProjectId: projectId, content: '' }, (err, newId) => {
      if (err) {
        notify({ message: `Create note failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setActivePanel({ type: 'note', id: newId });
    });
  };

  const activePanelIdx = activePanel?.type === 'session'
    ? sessions.findIndex(s => s._id === activePanel.id)
    : -1;

  return (
    <div className="ccPage">
      <ProjectList
        activeProjectId={projectId}
        homeDir={homeDir}
        activePanel={activePanel}
        onPanelClick={(panel) => setActivePanel(panel)}
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
                <span className={`ccTabStatus ccStatus-${session.status}`} />
              </button>
            ))}
            {notes.map((note) => (
              <button
                key={note._id}
                className={`ccSessionTab ccNoteTab ${activePanel?.type === 'note' && activePanel.id === note._id ? 'ccSessionTabActive' : ''}`}
                onClick={() => setActivePanel({ type: 'note', id: note._id })}
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
          {activePanel?.type === 'note' ? (
            <div className="ccPanel ccPanelActive">
              <NotePanel key={activePanel.id} noteId={activePanel.id} claudeProjectId={projectId} />
            </div>
          ) : (
            sessions.map((session, idx) => (
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
                  />
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
