import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { ProjectList } from './ProjectList.jsx';
import { SessionView } from './SessionView.jsx';
import { useHomeDir } from './useHomeDir.js';
import { notify } from '/imports/ui/utils/notify.js';
import { navigateTo } from '/imports/ui/router.js';
import './ClaudeCodePage.css';

const STORAGE_KEY = 'claude-activeSession';
const PROJECT_STORAGE_KEY = 'claude-activeProject';

export const ClaudeCodePage = ({ projectId }) => {
  const homeDir = useHomeDir();
  const [activePanelIdx, setActivePanelIdx] = useState(0);
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

  // Subscribe to sessions for the active project
  useSubscribe('claudeSessions.byProject', projectId || '__none__');

  // Sessions are the source of truth for panels (reactive via useFind)
  const sessions = useFind(() =>
    ClaudeSessionsCollection.find(
      projectId ? { projectId } : { projectId: '__none__' },
      { sort: { createdAt: 1 } }
    ),
    [projectId]
  );

  // Clamp activePanelIdx when sessions change
  useEffect(() => {
    if (sessions.length > 0 && activePanelIdx >= sessions.length) {
      setActivePanelIdx(sessions.length - 1);
    }
  }, [sessions.length, activePanelIdx]);

  // Restore active session from localStorage when project changes or sessions load
  useEffect(() => {
    if (!projectId) {
      setActivePanelIdx(0);
      restoredForProject.current = null;
      return;
    }
    if (sessions.length === 0) return;
    if (restoredForProject.current === projectId) return;

    restoredForProject.current = projectId;
    const savedSessionId = localStorage.getItem(`${STORAGE_KEY}-${projectId}`);
    if (savedSessionId) {
      const idx = sessions.findIndex(s => s._id === savedSessionId);
      if (idx >= 0) {
        setActivePanelIdx(idx);
        requestAnimationFrame(() => {
          panelRefs.current[idx]?.scrollIntoView({ behavior: 'auto', inline: 'start', block: 'nearest' });
        });
        return;
      }
    }
    setActivePanelIdx(0);
  }, [projectId, sessions]);

  // Persist active session ID to localStorage
  useEffect(() => {
    if (projectId && sessions.length > 0 && sessions[activePanelIdx]) {
      localStorage.setItem(`${STORAGE_KEY}-${projectId}`, sessions[activePanelIdx]._id);
    }
  }, [projectId, activePanelIdx, sessions]);

  // Keyboard shortcuts: Cmd-D (new session / split), Cmd-W (close session)
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
          // The new session will appear reactively via useFind;
          // set active to the last panel (the new one)
          setActivePanelIdx(sessions.length); // will be clamped by effect if needed
        });
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (sessions.length <= 1) return;
        const idx = Math.min(activePanelIdx, sessions.length - 1);
        const sessionToRemove = sessions[idx];
        if (!sessionToRemove) return;
        Meteor.call('claudeSessions.remove', sessionToRemove._id, (err) => {
          if (err) {
            notify({ message: `Close failed: ${err.reason || err.message}`, kind: 'error' });
            return;
          }
          setActivePanelIdx(prev => Math.min(prev, sessions.length - 2));
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, activePanelIdx, sessions.length, sessions]);

  return (
    <div className="ccPage">
      <ProjectList
        activeProjectId={projectId}
        homeDir={homeDir}
        activePanelIdx={activePanelIdx}
        onSessionClick={(idx) => {
          setActivePanelIdx(idx);
          panelRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }}
      />
      <div className="ccMain">
        {!projectId && (
          <div className="ccSessionViewEmpty">
            <p className="muted">Select or create a project to start.</p>
          </div>
        )}
        {projectId && sessions.length === 0 && (
          <div className="ccSessionViewEmpty">
            <p className="muted">Loading sessions...</p>
          </div>
        )}
        {sessions.length > 0 && (
          <div className="ccSessionTabs">
            {sessions.map((session, idx) => (
              <button
                key={session._id}
                className={`ccSessionTab ${idx === activePanelIdx ? 'ccSessionTabActive' : ''}`}
                onClick={() => {
                  setActivePanelIdx(idx);
                  panelRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
                }}
              >
                {session.name}
                <span className={`ccTabStatus ccStatus-${session.status}`} />
              </button>
            ))}
          </div>
        )}
        <div className="ccPanels">
          {sessions.map((session, idx) => (
            <React.Fragment key={session._id}>
              {idx > 0 && <div className="ccPanelDivider" />}
              <div
                className={`ccPanel ${idx === activePanelIdx ? 'ccPanelActive' : ''}`}
                ref={el => panelRefs.current[idx] = el}
                onClick={() => setActivePanelIdx(idx)}
              >
                <SessionView
                  sessionId={session._id}
                  homeDir={homeDir}
                  isActive={idx === activePanelIdx}
                  onFocus={() => setActivePanelIdx(idx)}
                />
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
