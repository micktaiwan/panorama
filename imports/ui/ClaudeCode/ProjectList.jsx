import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ClaudeProjectsCollection } from '/imports/api/claudeProjects/collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { navigateTo } from '/imports/ui/router.js';
import { notify } from '/imports/ui/utils/notify.js';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { shortenPath } from './useHomeDir.js';
import './ProjectList.css';

const projectStatus = (sessions) => {
  if (sessions.some(s => s.status === 'running')) return 'running';
  if (sessions.some(s => s.status === 'error')) return 'error';
  return 'idle';
};

export const ProjectList = ({ activeProjectId, homeDir, activePanelIdx, onSessionClick }) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCwd, setNewCwd] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newPermMode, setNewPermMode] = useState('acceptEdits');

  const { projects, allSessions } = useTracker(() => {
    Meteor.subscribe('claudeProjects');
    Meteor.subscribe('claudeSessions');
    return {
      projects: ClaudeProjectsCollection.find({}, { sort: { updatedAt: -1 } }).fetch(),
      allSessions: ClaudeSessionsCollection.find({}, { fields: { projectId: 1, status: 1, name: 1, createdAt: 1 }, sort: { createdAt: 1 } }).fetch(),
    };
  });

  const sessionsByProject = {};
  allSessions.forEach(s => {
    if (!s.projectId) return;
    if (!sessionsByProject[s.projectId]) sessionsByProject[s.projectId] = [];
    sessionsByProject[s.projectId].push(s);
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
        <button className="btn btn-small btn-primary" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancel' : '+ New'}
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
          const status = projectStatus(sessions);
          return (
            <div
              key={p._id}
              className={`ccProjectItem ${p._id === activeProjectId ? 'active' : ''}`}
              onClick={() => navigateTo({ name: 'claude', projectId: p._id })}
            >
              <div className="ccProjectItemTop">
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
              {p._id === activeProjectId && sessions.length > 0 && (
                <div className="ccSessionList">
                  {sessions.map((s, idx) => (
                    <div
                      key={s._id}
                      className={`ccSessionItem ${idx === activePanelIdx ? 'ccSessionItemActive' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (idx !== activePanelIdx) {
                          onSessionClick?.(idx);
                        }
                      }}
                    >
                      <span className={`ccStatusDot ccStatusDot--small ccStatus-${s.status}`} />
                      {idx === activePanelIdx ? (
                        <InlineEditable
                          value={s.name || `Session ${idx + 1}`}
                          className="ccSessionItemName"
                          onSubmit={(name) => {
                            Meteor.call('claudeSessions.update', s._id, { name }, (err) => {
                              if (err) notify({ message: `Rename failed: ${err.reason || err.message}`, kind: 'error' });
                            });
                          }}
                        />
                      ) : (
                        <span className="ccSessionItemName">{s.name || `Session ${idx + 1}`}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
