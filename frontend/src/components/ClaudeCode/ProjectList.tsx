import { useState, useCallback } from 'react';
import { claudeCode } from '../../services/api';
import type { ClaudeProject, ClaudeSession, Project } from '../../types';
import './ProjectList.css';

const COLLAPSE_KEY = 'cc-collapsed-projects';

function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveCollapsed(s: Set<string>) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...s]));
}

function shortenPath(p: string, homeDir: string): string {
  if (!p || !homeDir) return p;
  return p.startsWith(homeDir) ? '~' + p.slice(homeDir.length) : p;
}

function projectStatus(sessions: ClaudeSession[]): string {
  if (sessions.some(s => s.status === 'running')) return 'running';
  if (sessions.some(s => s.unseenCompleted)) return 'completed';
  if (sessions.some(s => s.status === 'error')) return 'error';
  return 'idle';
}

interface Props {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  normalProjects: Project[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  homeDir: string;
  onSelectProject: (id: string) => void;
  onSelectSession: (id: string) => void;
  onProjectCreated: (project: ClaudeProject) => void;
  onProjectDeleted: (id: string) => void;
  onSessionCreated: (session: ClaudeSession) => void;
  onSessionDeleted: (id: string) => void;
  onProjectsChanged: () => void;
}

export function ProjectList({
  projects, sessions, normalProjects, activeProjectId, activeSessionId, homeDir,
  onSelectProject, onSelectSession, onProjectCreated, onProjectDeleted,
  onSessionCreated, onSessionDeleted, onProjectsChanged,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCwd, setNewCwd] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newPermMode, setNewPermMode] = useState('acceptEdits');
  const [newLinkedProjectId, setNewLinkedProjectId] = useState('');
  const [collapsedIds, setCollapsedIds] = useState(loadCollapsed);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<ClaudeProject>>({});

  const toggleCollapse = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const handleCreate = async () => {
    try {
      const { project } = await claudeCode.createProject({
        name: newName.trim() || 'New Project',
        cwd: newCwd,
        model: newModel,
        permissionMode: newPermMode || undefined,
        linkedProjectId: newLinkedProjectId || null,
      } as Partial<ClaudeProject>);
      setCreating(false);
      setNewName('');
      setNewCwd('');
      setNewModel('');
      setNewPermMode('acceptEdits');
      setNewLinkedProjectId('');
      onProjectCreated(project);
    } catch (err: any) {
      console.error('Create failed:', err.message);
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('Supprimer ce projet et toutes ses sessions ?')) return;
    try {
      await claudeCode.deleteProject(projectId);
      onProjectDeleted(projectId);
    } catch (err: any) {
      console.error('Delete failed:', err.message);
    }
  };

  const handleCreateSession = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      const { session } = await claudeCode.createSession(projectId);
      onSessionCreated(session);
    } catch (err: any) {
      console.error('Create session failed:', err.message);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await claudeCode.deleteSession(sessionId);
      onSessionDeleted(sessionId);
    } catch (err: any) {
      console.error('Delete session failed:', err.message);
    }
  };

  const startRename = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setEditingName(id);
    setEditValue(name);
  };

  const submitRename = async (id: string, isProject: boolean) => {
    if (!editValue.trim()) { setEditingName(null); return; }
    try {
      if (isProject) {
        await claudeCode.updateProject(id, { name: editValue.trim() } as Partial<ClaudeProject>);
        onProjectsChanged();
      } else {
        await claudeCode.updateSession(id, { name: editValue.trim() } as Partial<ClaudeSession>);
        onProjectsChanged();
      }
    } catch (err: any) {
      console.error('Rename failed:', err.message);
    }
    setEditingName(null);
  };

  const startEditProject = (e: React.MouseEvent, p: ClaudeProject) => {
    e.stopPropagation();
    if (editingProject === p._id) {
      setEditingProject(null);
      return;
    }
    setEditingProject(p._id);
    setEditFields({
      name: p.name,
      cwd: p.cwd,
      model: p.model,
      permissionMode: p.permissionMode,
      linkedProjectId: p.linkedProjectId,
    });
  };

  const saveEditProject = async (id: string) => {
    try {
      await claudeCode.updateProject(id, editFields as Partial<ClaudeProject>);
      onProjectsChanged();
      setEditingProject(null);
    } catch (err: any) {
      console.error('Update failed:', err.message);
    }
  };

  // Group sessions by project
  const sessionsByProject: Record<string, ClaudeSession[]> = {};
  sessions.forEach(s => {
    if (!sessionsByProject[s.projectId]) sessionsByProject[s.projectId] = [];
    sessionsByProject[s.projectId].push(s);
  });

  return (
    <div className="cc-sidebar">
      <div className="cc-sidebar-header">
        <span className="cc-sidebar-title">Projects</span>
        <button className="cc-sidebar-btn" onClick={() => setCreating(!creating)}>
          {creating ? '\u00d7' : '+'}
        </button>
      </div>

      {creating && (
        <div className="cc-new-form">
          <input
            autoFocus
            placeholder="Project name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
          />
          <input
            placeholder="Working directory"
            value={newCwd}
            onChange={e => setNewCwd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <input
            placeholder="Model (optional)"
            value={newModel}
            onChange={e => setNewModel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <select value={newPermMode} onChange={e => setNewPermMode(e.target.value)}>
            <option value="">Default</option>
            <option value="plan">Plan</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="bypassPermissions">Bypass</option>
          </select>
          <select value={newLinkedProjectId} onChange={e => setNewLinkedProjectId(e.target.value)}>
            <option value="">Lier à un projet...</option>
            {normalProjects.map(np => (
              <option key={np._id} value={np._id}>{np.name}</option>
            ))}
          </select>
          <button className="cc-btn-create" onClick={handleCreate}>Create</button>
        </div>
      )}

      <div className="cc-project-items">
        {projects.length === 0 && !creating && (
          <p className="cc-no-items">No projects yet.</p>
        )}
        {projects.map(p => {
          const pSessions = sessionsByProject[p._id] || [];
          const status = projectStatus(pSessions);
          const isActive = p._id === activeProjectId;
          const isExpanded = !collapsedIds.has(p._id);

          return (
            <div
              key={p._id}
              className={`cc-project-item ${isActive ? 'cc-project-active' : ''}`}
              onClick={() => onSelectProject(p._id)}
            >
              <div className="cc-project-top">
                <button
                  className={`cc-chevron ${isExpanded ? 'cc-chevron-open' : ''}`}
                  onClick={e => toggleCollapse(e, p._id)}
                >{'\u25B6'}</button>
                <span className={`cc-status-dot cc-status-${status}`} />
                {editingName === p._id ? (
                  <input
                    className="cc-inline-edit"
                    value={editValue}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitRename(p._id, true); if (e.key === 'Escape') setEditingName(null); }}
                    onBlur={() => submitRename(p._id, true)}
                  />
                ) : (
                  <span
                    className="cc-project-name"
                    onDoubleClick={e => startRename(e, p._id, p.name)}
                  >{p.name}</span>
                )}
                <button className="cc-item-settings" onClick={e => startEditProject(e, p)} title="Settings">&#9881;</button>
                <button className="cc-item-remove" onClick={e => handleDelete(e, p._id)}>&times;</button>
              </div>
              {p.cwd && <span className="cc-project-cwd">{shortenPath(p.cwd, homeDir)}</span>}
              {p.linkedProjectId && (() => {
                const linked = normalProjects.find(np => np._id === p.linkedProjectId);
                return linked ? <span className="cc-project-linked">{linked.name}</span> : null;
              })()}
              {editingProject === p._id && (
                <div className="cc-edit-form" onClick={e => e.stopPropagation()}>
                  <label>Nom</label>
                  <input
                    value={editFields.name || ''}
                    onChange={e => setEditFields(prev => ({ ...prev, name: e.target.value }))}
                  />
                  <label>Répertoire</label>
                  <input
                    value={editFields.cwd || ''}
                    onChange={e => setEditFields(prev => ({ ...prev, cwd: e.target.value }))}
                  />
                  <label>Modèle</label>
                  <input
                    value={editFields.model || ''}
                    onChange={e => setEditFields(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="claude-sonnet-4-5-20250929"
                  />
                  <label>Permissions</label>
                  <select
                    value={editFields.permissionMode || ''}
                    onChange={e => setEditFields(prev => ({ ...prev, permissionMode: e.target.value }))}
                  >
                    <option value="">Default</option>
                    <option value="plan">Plan</option>
                    <option value="acceptEdits">Accept Edits</option>
                    <option value="bypassPermissions">Bypass</option>
                  </select>
                  <label>Projet lié</label>
                  <select
                    value={editFields.linkedProjectId || ''}
                    onChange={e => setEditFields(prev => ({ ...prev, linkedProjectId: e.target.value || null }))}
                  >
                    <option value="">Aucun</option>
                    {normalProjects.map(np => (
                      <option key={np._id} value={np._id}>{np.name}</option>
                    ))}
                  </select>
                  <div className="cc-edit-btns">
                    <button className="cc-btn-create" onClick={() => saveEditProject(p._id)}>Enregistrer</button>
                    <button className="cc-btn-cancel" onClick={() => setEditingProject(null)}>Annuler</button>
                  </div>
                </div>
              )}
              {isExpanded && (
                <div className="cc-session-list">
                  {pSessions.map(s => (
                    <div
                      key={s._id}
                      className={`cc-session-item ${s._id === activeSessionId ? 'cc-session-active' : ''}`}
                      onClick={e => { e.stopPropagation(); onSelectProject(p._id); onSelectSession(s._id); }}
                    >
                      <span className={`cc-status-dot cc-status-dot-small cc-status-${s.unseenCompleted ? 'completed' : s.status}`} />
                      {editingName === s._id ? (
                        <input
                          className="cc-inline-edit"
                          value={editValue}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(s._id, false); if (e.key === 'Escape') setEditingName(null); }}
                          onBlur={() => submitRename(s._id, false)}
                        />
                      ) : (
                        <span
                          className="cc-session-name"
                          onDoubleClick={e => startRename(e, s._id, s.name)}
                        >{s.name || 'Session'}</span>
                      )}
                      <button className="cc-item-remove cc-item-remove-small" onClick={e => handleDeleteSession(e, s._id)}>&times;</button>
                    </div>
                  ))}
                  {isActive && (
                    <button className="cc-new-session-btn" onClick={e => handleCreateSession(e, p._id)}>
                      + Session
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
