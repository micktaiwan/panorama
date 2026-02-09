import React, { useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ClaudeProjectsCollection } from '/imports/api/claudeProjects/collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { navigateTo } from '/imports/ui/router.js';
import { notify } from '/imports/ui/utils/notify.js';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { shortenPath } from './useHomeDir.js';
import { AgentTeams } from './AgentTeams.jsx';
import './ProjectList.css';

const COLLAPSE_STORAGE_KEY = 'claude-collapsed-projects';

const loadCollapsed = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '[]'));
  } catch { return new Set(); }
};

const saveCollapsed = (set) => {
  localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...set]));
};

const projectStatus = (sessions) => {
  if (sessions.some(s => s.status === 'running')) return 'running';
  if (sessions.some(s => s.unseenCompleted)) return 'completed';
  if (sessions.some(s => s.status === 'error')) return 'error';
  return 'idle';
};

export const ProjectList = ({ activeProjectId, homeDir, activePanel, sidebarItems = [], activeSidebarId, onPanelClick, onSidebarToggle }) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCwd, setNewCwd] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newPermMode, setNewPermMode] = useState('acceptEdits');
  const [collapsedIds, setCollapsedIds] = useState(loadCollapsed);

  const toggleCollapse = useCallback((e, projectId) => {
    e.stopPropagation();
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const { projects, allSessions, allNotes } = useTracker(() => {
    Meteor.subscribe('claudeProjects');
    Meteor.subscribe('claudeSessions');
    Meteor.subscribe('notes');
    return {
      projects: ClaudeProjectsCollection.find({}, { sort: { updatedAt: -1 } }).fetch(),
      allSessions: ClaudeSessionsCollection.find({}, { fields: { projectId: 1, status: 1, unseenCompleted: 1, name: 1, createdAt: 1 }, sort: { createdAt: 1 } }).fetch(),
      allNotes: NotesCollection.find({ claudeProjectId: { $exists: true, $ne: null } }, { fields: { claudeProjectId: 1, title: 1, createdAt: 1 }, sort: { createdAt: 1 } }).fetch(),
    };
  });

  const sessionsByProject = {};
  allSessions.forEach(s => {
    if (!s.projectId) return;
    if (!sessionsByProject[s.projectId]) sessionsByProject[s.projectId] = [];
    sessionsByProject[s.projectId].push(s);
  });

  const notesByProject = {};
  allNotes.forEach(n => {
    if (!n.claudeProjectId) return;
    if (!notesByProject[n.claudeProjectId]) notesByProject[n.claudeProjectId] = [];
    notesByProject[n.claudeProjectId].push(n);
  });

  const handleCreate = () => {
    const name = newName.trim() || 'New Project';
    Meteor.call('claudeProjects.create', { name, cwd: newCwd, model: newModel, permissionMode: newPermMode || undefined }, (err, id) => {
      if (err) {
        notify({ message: `Create failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setCreating(false);
      setNewName('');
      setNewCwd('');
      setNewModel('');
      setNewPermMode('acceptEdits');
      navigateTo({ name: 'claude', projectId: id });
    });
  };

  const handleRemove = (e, projectId) => {
    e.stopPropagation();
    Meteor.call('claudeProjects.remove', projectId, (err) => {
      if (err) notify({ message: `Remove failed: ${err.reason || err.message}`, kind: 'error' });
      else if (activeProjectId === projectId) navigateTo({ name: 'claude' });
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') setCreating(false);
  };

  return (
    <div className="ccProjectList">
      <div className="ccProjectListHeader">
        <span className="ccProjectListTitle">Projects</span>
        <button className="ccNewProjectBtn" onClick={() => setCreating(!creating)}>
          {creating ? '×' : '+'}
        </button>
      </div>

      {creating && (
        <div className="ccNewProjectForm">
          <input
            autoFocus
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <input
            placeholder="Working directory (optional)"
            value={newCwd}
            onChange={(e) => setNewCwd(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <input
            placeholder="Model (optional)"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <select
            value={newPermMode}
            onChange={(e) => setNewPermMode(e.target.value)}
          >
            <option value="">Default (interactive)</option>
            <option value="plan">Plan (read-only)</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="dontAsk">Don't Ask</option>
            <option value="bypassPermissions">Bypass Permissions</option>
          </select>
          <button className="btn btn-small btn-primary" onClick={handleCreate}>Create</button>
        </div>
      )}

      <div className="ccProjectItems scrollArea">
        {projects.length === 0 && !creating && (
          <p className="muted ccNoProjects">No projects yet.</p>
        )}
        {projects.map((p) => {
          const sessions = sessionsByProject[p._id] || [];
          const projectNotes = notesByProject[p._id] || [];
          const status = projectStatus(sessions);
          return (
            <div
              key={p._id}
              className={`ccProjectItem ${p._id === activeProjectId ? 'active' : ''}`}
              onClick={() => navigateTo({ name: 'claude', projectId: p._id })}
            >
              {(() => {
                const hasUnseen = sessions.some(s => s.unseenCompleted);
                const userCollapsed = collapsedIds.has(p._id);
                const isExpanded = !userCollapsed || hasUnseen;
                return (
                  <>
                    <div className="ccProjectItemTop">
                      <button
                        className={`ccChevron ${isExpanded ? 'ccChevronOpen' : ''}`}
                        onClick={(e) => toggleCollapse(e, p._id)}
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >&#9656;</button>
                      <span className={`ccStatusDot ccStatus-${status}`} />
                      <InlineEditable
                        value={p.name}
                        className="ccProjectItemName"
                        onSubmit={(name) => {
                          Meteor.call('claudeProjects.update', p._id, { name }, (err) => {
                            if (err) notify({ message: `Rename failed: ${err.reason || err.message}`, kind: 'error' });
                          });
                        }}
                      />
                      <button
                        className="ccProjectItemRemove"
                        onClick={(e) => handleRemove(e, p._id)}
                        title="Delete project"
                      >&times;</button>
                    </div>
                    {p.cwd && <span className="ccProjectItemCwd muted">{shortenPath(p.cwd, homeDir)}</span>}
                    {isExpanded && (sessions.length > 0 || projectNotes.length > 0) && (
                      <div className="ccSessionList">
                        {sessions.map((s) => (
                          <div
                            key={s._id}
                            className={`ccSessionItem ${activePanel?.type === 'session' && activePanel?.id === s._id ? 'ccSessionItemActive' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (p._id !== activeProjectId) {
                                // Pre-save target session so restore effect picks it up
                                localStorage.setItem(`claude-activePanel-${p._id}`, JSON.stringify({ type: 'session', id: s._id }));
                                navigateTo({ name: 'claude', projectId: p._id });
                              } else if (activePanel?.type !== 'session' || activePanel?.id !== s._id) {
                                onPanelClick?.({ type: 'session', id: s._id });
                              }
                            }}
                          >
                            <span className={`ccStatusDot ccStatusDot--small ccStatus-${s.unseenCompleted ? 'completed' : s.status}`} />
                            {p._id === activeProjectId && activePanel?.type === 'session' && activePanel?.id === s._id ? (
                              <InlineEditable
                                value={s.name || 'Session'}
                                className="ccSessionItemName"
                                onSubmit={(name) => {
                                  Meteor.call('claudeSessions.update', s._id, { name }, (err) => {
                                    if (err) notify({ message: `Rename failed: ${err.reason || err.message}`, kind: 'error' });
                                  });
                                }}
                              />
                            ) : (
                              <span className="ccSessionItemName">{s.name || 'Session'}</span>
                            )}
                          </div>
                        ))}
                        {projectNotes.map((n) => (
                          <div
                            key={n._id}
                            className={`ccSessionItem ccNoteItem ${sidebarItems.includes(n._id) ? 'ccSessionItemActive' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (p._id !== activeProjectId) {
                                // Pre-save sidebar state so restore effect opens the note
                                const existing = (() => {
                                  try { return JSON.parse(localStorage.getItem(`claude-sidebar-${p._id}`) || '[]'); }
                                  catch { return []; }
                                })();
                                if (!existing.includes(n._id)) existing.push(n._id);
                                localStorage.setItem(`claude-sidebar-${p._id}`, JSON.stringify(existing));
                                localStorage.setItem(`claude-activeSidebar-${p._id}`, n._id);
                                navigateTo({ name: 'claude', projectId: p._id });
                              } else {
                                onSidebarToggle?.(n._id);
                              }
                            }}
                          >
                            <span className="ccNoteIcon">N</span>
                            <span className="ccSessionItemName">{n.title || 'Untitled'}</span>
                          </div>
                        ))}
                        {p._id === activeProjectId && sidebarItems.filter(id => id.startsWith('file:')).map((id) => (
                          <div
                            key={id}
                            className={`ccSessionItem ccFileItem ${activeSidebarId === id ? 'ccSessionItemActive' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSidebarToggle?.(id);
                            }}
                            title={id.slice(5)}
                          >
                            <span className="ccFileIcon">F</span>
                            <span className="ccSessionItemName">{id.slice(5).split('/').pop()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>
      <AgentTeams />
    </div>
  );
};
