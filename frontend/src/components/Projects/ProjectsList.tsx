import { useEffect, useState, useCallback, useRef } from 'react';
import { projects as projectsApi, tasks as tasksApi, notes as notesApi, links as linksApi, files as filesApi, claudeCode } from '../../services/api';
import { socketService } from '../../services/socket';
import { getApiBaseUrl } from '../../services/api';
import type { Project, Task, Note, Link, FileDoc, ClaudeProject } from '../../types';
import './ProjectsList.css';

// ─── Task Item ───────────────────────────────────────────────
function TaskItem({ task, onUpdate, onDelete }: {
  task: Task;
  onUpdate: (t: Task) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  const statusCycle: Task['status'][] = ['todo', 'in_progress', 'done'];
  const currentIdx = statusCycle.indexOf(task.status);
  const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];

  const handleStatusToggle = async () => {
    const { task: updated } = await tasksApi.update(task._id, { status: nextStatus });
    onUpdate(updated);
  };

  const handleSaveTitle = async () => {
    if (!title.trim() || title.trim() === task.title) {
      setTitle(task.title);
      setEditing(false);
      return;
    }
    const { task: updated } = await tasksApi.update(task._id, { title: title.trim() });
    onUpdate(updated);
    setEditing(false);
  };

  const handleToggleUrgent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { task: updated } = await tasksApi.update(task._id, { urgent: !task.urgent });
    onUpdate(updated);
  };

  const handleToggleImportant = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { task: updated } = await tasksApi.update(task._id, { important: !task.important });
    onUpdate(updated);
  };

  const handleDeadlineChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const { task: updated } = await tasksApi.update(task._id, { deadline: val || null });
    onUpdate(updated);
  };

  const statusIcon = task.status === 'done' ? '\u2611' : task.status === 'in_progress' ? '\u25B6' : '\u2610';

  return (
    <div className={`task-item-row ${task.status === 'done' ? 'done' : ''}`}>
      <button className="task-status-btn" onClick={handleStatusToggle} title={`Passer en ${nextStatus}`}>
        {statusIcon}
      </button>
      <button
        className={`task-flag-btn ${task.urgent ? 'active urgent' : ''}`}
        onClick={handleToggleUrgent}
        title="Urgent"
      >!</button>
      <button
        className={`task-flag-btn ${task.important ? 'active important' : ''}`}
        onClick={handleToggleImportant}
        title="Important"
      >*</button>
      {editing ? (
        <input
          className="task-edit-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') { setTitle(task.title); setEditing(false); } }}
          autoFocus
        />
      ) : (
        <span className="task-title" onDoubleClick={() => setEditing(true)}>{task.title}</span>
      )}
      <input
        type="date"
        className="task-deadline-input"
        value={task.deadline ? task.deadline.slice(0, 10) : ''}
        onChange={handleDeadlineChange}
        title="Deadline"
      />
      <button className="task-delete-btn" onClick={() => onDelete(task._id)} title="Supprimer">&times;</button>
    </div>
  );
}

// ─── Link Item ───────────────────────────────────────────────
function LinkItem({ link, onUpdate, onDelete }: {
  link: Link;
  onUpdate: (l: Link) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(link.name);
  const [url, setUrl] = useState(link.url);

  const handleSave = async () => {
    const { link: updated } = await linksApi.update(link._id, { name: name.trim(), url: url.trim() });
    onUpdate(updated);
    setEditing(false);
  };

  const handleClick = async () => {
    linksApi.click(link._id).catch(() => {});
  };

  if (editing) {
    return (
      <div className="link-edit-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom" className="link-edit-input" />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="URL" className="link-edit-input" />
        <button className="btn-sm" onClick={handleSave}>OK</button>
        <button className="btn-sm" onClick={() => { setName(link.name); setUrl(link.url); setEditing(false); }}>X</button>
      </div>
    );
  }

  return (
    <div className="related-item link-item-row">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="related-link" onClick={handleClick}>
        {link.name || link.url}
      </a>
      <div className="item-actions">
        <button className="btn-sm" onClick={() => setEditing(true)} title="Modifier">&#9998;</button>
        <button className="btn-sm danger" onClick={() => onDelete(link._id)} title="Supprimer">&times;</button>
      </div>
    </div>
  );
}

// ─── Note Item ───────────────────────────────────────────────
function NoteItem({ note, onUpdate, onDelete }: {
  note: Note;
  onUpdate: (n: Note) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  const handleSave = async () => {
    const { note: updated } = await notesApi.update(note._id, { title: title.trim(), content });
    onUpdate(updated);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="note-edit-form">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Titre"
          className="note-edit-title"
          autoFocus
        />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Contenu..."
          className="note-edit-content"
          rows={4}
        />
        <div className="note-edit-actions">
          <button className="btn-sm primary" onClick={handleSave}>Enregistrer</button>
          <button className="btn-sm" onClick={() => { setTitle(note.title); setContent(note.content); setEditing(false); }}>Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div className="related-item note-item-row">
      <span className="related-title">{note.title}</span>
      <span className="related-date">{new Date(note.updatedAt).toLocaleDateString('fr-FR')}</span>
      <div className="item-actions">
        <button className="btn-sm" onClick={() => setEditing(true)} title="Modifier">&#9998;</button>
        <button className="btn-sm danger" onClick={() => onDelete(note._id)} title="Supprimer">&times;</button>
      </div>
    </div>
  );
}

// ─── File Item ───────────────────────────────────────────────
function FileItem({ file, onDelete }: {
  file: FileDoc;
  onDelete: (id: string) => void;
}) {
  const downloadUrl = `${getApiBaseUrl()}/files/${file._id}/download`;

  return (
    <div className="related-item file-item-row">
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="related-link">{file.name}</a>
      <span className="related-date">{(file.size / 1024).toFixed(0)} Ko</span>
      <div className="item-actions">
        <button className="btn-sm danger" onClick={() => onDelete(file._id)} title="Supprimer">&times;</button>
      </div>
    </div>
  );
}

// ─── Project Detail ──────────────────────────────────────────
function ProjectDetail({ project, onBack, onUpdate }: {
  project: Project;
  onBack: () => void;
  onUpdate: (p: Project) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [linksList, setLinksList] = useState<Link[]>([]);
  const [filesList, setFilesList] = useState<FileDoc[]>([]);
  const [claudeProjects, setClaudeProjects] = useState<ClaudeProject[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description || '');
  const [editStatus, setEditStatus] = useState(project.status);

  // Create forms
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [showNewLink, setShowNewLink] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [showNewNote, setShowNewNote] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRelated = useCallback(async () => {
    const [t, n, l, f, cp] = await Promise.all([
      tasksApi.list({ projectId: project._id }).catch(() => ({ tasks: [] })),
      notesApi.list({ projectId: project._id }).catch(() => ({ notes: [] })),
      linksApi.list({ projectId: project._id }).catch(() => ({ links: [] })),
      filesApi.list({ projectId: project._id }).catch(() => ({ files: [] })),
      claudeCode.listProjects().catch(() => ({ projects: [] })),
    ]);
    setTasks(t.tasks);
    setNotesList(n.notes);
    setLinksList(l.links);
    setFilesList(f.files);
    setClaudeProjects(cp.projects.filter(p => p.linkedProjectId === project._id));
  }, [project._id]);

  useEffect(() => {
    loadRelated();
  }, [loadRelated]);

  const handleSave = async () => {
    const { project: updated } = await projectsApi.update(project._id, {
      name: editName.trim(),
      description: editDesc.trim(),
      status: editStatus,
    });
    onUpdate(updated);
    setEditing(false);
  };

  // ── Tasks ──
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const { task } = await tasksApi.create({ title: newTaskTitle.trim(), projectId: project._id });
    setTasks(prev => [...prev, task]);
    setNewTaskTitle('');
    setShowNewTask(false);
  };

  const handleUpdateTask = (updated: Task) => {
    setTasks(prev => prev.map(t => t._id === updated._id ? updated : t));
  };

  const handleDeleteTask = async (id: string) => {
    await tasksApi.delete(id);
    setTasks(prev => prev.filter(t => t._id !== id));
  };

  // ── Links ──
  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLinkUrl.trim()) return;
    const { link } = await linksApi.create({ name: newLinkName.trim(), url: newLinkUrl.trim(), projectId: project._id });
    setLinksList(prev => [...prev, link]);
    setNewLinkName('');
    setNewLinkUrl('');
    setShowNewLink(false);
  };

  const handleUpdateLink = (updated: Link) => {
    setLinksList(prev => prev.map(l => l._id === updated._id ? updated : l));
  };

  const handleDeleteLink = async (id: string) => {
    await linksApi.delete(id);
    setLinksList(prev => prev.filter(l => l._id !== id));
  };

  // ── Notes ──
  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim()) return;
    const { note } = await notesApi.create({ title: newNoteTitle.trim(), projectId: project._id });
    setNotesList(prev => [...prev, note]);
    setNewNoteTitle('');
    setShowNewNote(false);
  };

  const handleUpdateNote = (updated: Note) => {
    setNotesList(prev => prev.map(n => n._id === updated._id ? updated : n));
  };

  const handleDeleteNote = async (id: string) => {
    await notesApi.delete(id);
    setNotesList(prev => prev.filter(n => n._id !== id));
  };

  // ── Files ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { file: uploaded } = await filesApi.upload(file, { projectId: project._id });
    setFilesList(prev => [...prev, uploaded]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteFile = async (id: string) => {
    await filesApi.delete(id);
    setFilesList(prev => prev.filter(f => f._id !== id));
  };

  const activeTasks = tasks.filter(t => t.status === 'todo' || t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'cancelled');

  return (
    <div className="project-detail">
      <button className="btn-back" onClick={onBack}>&larr; Projets</button>

      <div className="project-detail-header">
        {editing ? (
          <div className="project-edit-form">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="edit-name-input"
              autoFocus
            />
            <textarea
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description..."
              className="edit-desc-input"
              rows={3}
            />
            <div className="edit-row">
              <select value={editStatus} onChange={e => setEditStatus(e.target.value as Project['status'])}>
                <option value="active">Actif</option>
                <option value="paused">En pause</option>
                <option value="done">Terminé</option>
                <option value="archived">Archivé</option>
              </select>
              <div className="edit-actions">
                <button className="btn-primary" onClick={handleSave}>Enregistrer</button>
                <button onClick={() => setEditing(false)}>Annuler</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="detail-title-row">
              <h2>{project.name}</h2>
              <span className={`status-badge ${project.status}`}>{project.status}</span>
              <button className="btn-edit" onClick={() => setEditing(true)}>Modifier</button>
            </div>
            {project.description && <p className="detail-desc">{project.description}</p>}
          </>
        )}
      </div>

      <div className="project-sections">
        {/* ── Tasks ── */}
        <section className="project-section">
          <div className="section-header">
            <h3>Tâches ({tasks.length})</h3>
            <button className="btn-add" onClick={() => setShowNewTask(!showNewTask)}>+ Tâche</button>
          </div>
          {showNewTask && (
            <form className="inline-create-form" onSubmit={handleCreateTask}>
              <input
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder="Nouvelle tâche..."
                autoFocus
              />
              <button type="submit" className="btn-sm primary">OK</button>
              <button type="button" className="btn-sm" onClick={() => setShowNewTask(false)}>X</button>
            </form>
          )}
          {activeTasks.length === 0 && doneTasks.length === 0 && !showNewTask && (
            <p className="section-empty">Aucune tâche</p>
          )}
          {activeTasks.map(t => (
            <TaskItem key={t._id} task={t} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} />
          ))}
          {doneTasks.length > 0 && (
            <div className="done-section">
              <button className="btn-toggle-done" onClick={() => setShowDone(!showDone)}>
                {showDone ? '\u25BC' : '\u25B6'} Terminées ({doneTasks.length})
              </button>
              {showDone && doneTasks.map(t => (
                <TaskItem key={t._id} task={t} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} />
              ))}
            </div>
          )}
        </section>

        {/* ── Notes ── */}
        <section className="project-section">
          <div className="section-header">
            <h3>Notes ({notesList.length})</h3>
            <button className="btn-add" onClick={() => setShowNewNote(!showNewNote)}>+ Note</button>
          </div>
          {showNewNote && (
            <form className="inline-create-form" onSubmit={handleCreateNote}>
              <input
                value={newNoteTitle}
                onChange={e => setNewNoteTitle(e.target.value)}
                placeholder="Titre de la note..."
                autoFocus
              />
              <button type="submit" className="btn-sm primary">OK</button>
              <button type="button" className="btn-sm" onClick={() => setShowNewNote(false)}>X</button>
            </form>
          )}
          {notesList.length === 0 && !showNewNote ? (
            <p className="section-empty">Aucune note</p>
          ) : (
            notesList.map(n => (
              <NoteItem key={n._id} note={n} onUpdate={handleUpdateNote} onDelete={handleDeleteNote} />
            ))
          )}
        </section>

        {/* ── Links ── */}
        <section className="project-section">
          <div className="section-header">
            <h3>Liens ({linksList.length})</h3>
            <button className="btn-add" onClick={() => setShowNewLink(!showNewLink)}>+ Lien</button>
          </div>
          {showNewLink && (
            <form className="inline-create-form" onSubmit={handleCreateLink}>
              <input
                value={newLinkName}
                onChange={e => setNewLinkName(e.target.value)}
                placeholder="Nom (optionnel)"
              />
              <input
                value={newLinkUrl}
                onChange={e => setNewLinkUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
              />
              <button type="submit" className="btn-sm primary">OK</button>
              <button type="button" className="btn-sm" onClick={() => setShowNewLink(false)}>X</button>
            </form>
          )}
          {linksList.length === 0 && !showNewLink ? (
            <p className="section-empty">Aucun lien</p>
          ) : (
            linksList.map(l => (
              <LinkItem key={l._id} link={l} onUpdate={handleUpdateLink} onDelete={handleDeleteLink} />
            ))
          )}
        </section>

        {/* ── Files ── */}
        <section className="project-section">
          <div className="section-header">
            <h3>Fichiers ({filesList.length})</h3>
            <button className="btn-add" onClick={() => fileInputRef.current?.click()}>+ Fichier</button>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
          </div>
          {filesList.length === 0 ? (
            <p className="section-empty">Aucun fichier</p>
          ) : (
            filesList.map(f => (
              <FileItem key={f._id} file={f} onDelete={handleDeleteFile} />
            ))
          )}
        </section>

        {/* ── Claude Code projects ── */}
        {claudeProjects.length > 0 && (
          <section className="project-section">
            <div className="section-header">
              <h3>Claude Code ({claudeProjects.length})</h3>
            </div>
            {claudeProjects.map(cp => (
              <div key={cp._id} className="related-item claude-project-item">
                <span className="claude-project-icon">&#9000;</span>
                <span className="related-title">{cp.name}</span>
                {cp.cwd && <span className="related-date">{cp.cwd}</span>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Projects List ───────────────────────────────────────────
export function ProjectsList() {
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const { projects } = await projectsApi.list();
      setProjectsList(projects);
    } catch (err) {
      console.error('Load projects error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    socketService.subscribeProjects();

    const unsub1 = socketService.on('project:created', () => loadProjects());
    const unsub2 = socketService.on('project:updated', () => loadProjects());
    const unsub3 = socketService.on('project:deleted', () => loadProjects());
    const unsub4 = socketService.on('internal:connected', () => socketService.subscribeProjects());

    return () => {
      unsub1(); unsub2(); unsub3(); unsub4();
      socketService.unsubscribeProjects();
    };
  }, [loadProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await projectsApi.create({ name: newName.trim() });
    setNewName('');
    setShowCreate(false);
  };

  const handleToggleFavorite = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    await projectsApi.update(project._id, { isFavorite: !project.isFavorite });
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Supprimer ce projet et toutes ses données ?')) return;
    await projectsApi.delete(id);
    if (selectedProject?._id === id) setSelectedProject(null);
  };

  if (loading) return <div className="projects-loading">Chargement...</div>;

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
        onUpdate={(updated) => {
          setSelectedProject(updated);
          loadProjects();
        }}
      />
    );
  }

  return (
    <div className="projects-list">
      <div className="projects-header">
        <h2>Projets</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          + Nouveau
        </button>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="Nom du projet"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <button type="submit">Créer</button>
          <button type="button" onClick={() => setShowCreate(false)}>Annuler</button>
        </form>
      )}

      {projectsList.length === 0 ? (
        <p className="empty">Aucun projet. Créez-en un pour commencer.</p>
      ) : (
        <div className="projects-grid">
          {projectsList.map(project => (
            <div
              key={project._id}
              className="project-card clickable"
              onClick={() => setSelectedProject(project)}
            >
              <div className="project-card-header">
                <button
                  className={`fav-btn ${project.isFavorite ? 'active' : ''}`}
                  onClick={(e) => handleToggleFavorite(e, project)}
                >
                  {project.isFavorite ? '\u2605' : '\u2606'}
                </button>
                <h3>{project.name}</h3>
                <span className={`status-badge ${project.status}`}>{project.status}</span>
              </div>
              {project.description && (
                <p className="project-desc">{project.description.slice(0, 120)}</p>
              )}
              <div className="project-card-footer">
                <span className="project-date">
                  {new Date(project.updatedAt).toLocaleDateString('fr-FR')}
                </span>
                <button className="btn-danger-sm" onClick={(e) => handleDelete(e, project._id)}>
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
