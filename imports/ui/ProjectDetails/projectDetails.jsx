import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '../../api/projects/collections';
import { TasksCollection } from '../../api/tasks/collections';
import { NoteSessionsCollection } from '../../api/noteSessions/collections';
import { NotesCollection } from '../../api/notes/collections';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { Meteor } from 'meteor/meteor';
import { navigateTo } from '../router.js';
import './ProjectDetails.css';
import { Card } from '../components/Card/Card.jsx';
import { deadlineSeverity, timeAgo } from '../utils/date.js';
import { InlineDate } from '../InlineDate/InlineDate.jsx';
import { TaskRow } from '../components/TaskRow/TaskRow.jsx';
import { createNewLink } from '../utils/links.js';
import { LinksCollection } from '../../api/links/collections';
import { LinkItem } from '../components/Link/Link.jsx';
import { FilesCollection } from '../../api/files/collections';
import { FileItem } from '../components/File/File.jsx';
import { Tooltip } from '../components/Tooltip/Tooltip.jsx';
import { ClaudeProjectsCollection } from '../../api/claudeProjects/collections';
import { Collapsible } from '../components/Collapsible/Collapsible.jsx';
import { Modal } from '../components/Modal/Modal.jsx';
import { ActivitySummary } from '../components/ActivitySummary/ActivitySummary.jsx';

export const ProjectDetails = ({ projectId, onBack, onOpenNoteSession, onCreateTaskViaPalette }) => {
  const loadProjects = useSubscribe('projects');
  const loadTasks = useSubscribe('tasks');
  const loadSessions = useSubscribe('noteSessions');
  const loadNotes = useSubscribe('notes');
  const loadLinks = useSubscribe('links.byProject', projectId);
  const loadFiles = useSubscribe('files.byProject', projectId);
  const loadClaudeProjects = useSubscribe('claudeProjects');
  const loadMembers = useSubscribe('projectMembers', projectId);

  const project = useFind(() => ProjectsCollection.find({ _id: projectId }))[0];
  const linkedClaudeProjects = useFind(() => ClaudeProjectsCollection.find({ linkedProjectId: projectId }, { fields: { name: 1, linkedProjectId: 1 } }));
  const allProjects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1 } }));
  const projectOptions = useMemo(
    () => allProjects.map(p => ({ value: p._id, label: p.name || '(untitled project)' })),
    [allProjects]
  );
  const tasks = useFind(() => TasksCollection.find({ projectId }, { sort: { updatedAt: -1 } }));
  const activeTasks = useMemo(() => {
    const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
    return tasks
      .filter(t => !['done','cancelled'].includes(t.status || 'todo'))
      .sort((a, b) => {
        const ad = toTime(a.deadline);
        const bd = toTime(b.deadline);
        if (ad !== bd) return ad - bd;
        const as = statusRank(a.status || 'todo');
        const bs = statusRank(b.status || 'todo');
        if (as !== bs) return as - bs;
        const ar = Number.isFinite(a.priorityRank) ? a.priorityRank : Number.POSITIVE_INFINITY;
        const br = Number.isFinite(b.priorityRank) ? b.priorityRank : Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ac - bc;
      });
  }, [tasks]);
  const doneTasks = useMemo(() => tasks
    .filter(t => ['done','cancelled'].includes(t.status || 'todo'))
    .sort((a,b) => new Date((b.statusChangedAt || 0)) - new Date((a.statusChangedAt || 0))), [tasks, tasks && tasks.map(t => t.status || '').join(','), projectId]);
  // DnD setup for active tasks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [order, setOrder] = useState([]);
  const activeTaskIds = useMemo(() => activeTasks.map(t => t._id), [activeTasks]);
  React.useEffect(() => { setOrder(activeTaskIds); }, [activeTaskIds]);

  const SortableRow = ({ task, children }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task._id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    return (
      <li ref={setNodeRef} style={style} key={task._id} className={(task.status || 'todo') === 'done' ? 'taskDone' : ''}>
        <div className={`taskRow${(task.status || 'todo') === 'in_progress' ? ' inProgress' : ''}`}>
          <span className="dragHandle" {...attributes} {...listeners} title="Drag to reorder">≡</span>
          {children}
        </div>
      </li>
    );
  };

  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    // Persist priorityRank compact (0..n)
    next.forEach((id, idx) => { Meteor.call('tasks.update', id, { priorityRank: idx }); });
  };
  const [showDone, setShowDone] = useState(false);
  const sessions = useFind(() => NoteSessionsCollection.find({ projectId }, { sort: { createdAt: -1 } }));
  const notes = useFind(() => NotesCollection.find({ projectId }, { sort: { createdAt: -1 } }));
  const links = useFind(() => LinksCollection.find({ projectId }, { sort: { createdAt: -1 } }));
  const files = useFind(() => FilesCollection.find({ projectId }, { sort: { createdAt: -1 } }));
  const [noteToDeleteId, setNoteToDeleteId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [cleaningNoteIds, setCleaningNoteIds] = useState({});
  const [undoAvailable, setUndoAvailable] = useState({});

  // Members state
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const currentUserId = useTracker(() => Meteor.userId(), []);
  const isOwner = project?.userId === currentUserId;
  const members = useTracker(() => {
    if (!project?.memberIds) return [];
    return Meteor.users.find({ _id: { $in: project.memberIds } }).fetch();
  }, [project?.memberIds]);

  // Improve description (AI) modal state
  const [isImproveOpen, setIsImproveOpen] = useState(false);
  const [improveQuestions, setImproveQuestions] = useState([]);
  const [isLoadingImprove, setIsLoadingImprove] = useState(false);
  const [improveError, setImproveError] = useState('');
  const [answersText, setAnswersText] = useState('');
  const [isApplyingImprove, setIsApplyingImprove] = useState(false);

  const progress = useMemo(() => {
    if (!tasks || tasks.length === 0) return 0;
    const withProgress = tasks.filter(t => typeof t.progressPercent === 'number');
    if (withProgress.length === 0) return 0;
    return Math.round(withProgress.reduce((a, t) => a + t.progressPercent, 0) / withProgress.length);
  }, [tasks]);

  // Avoid brief loading flicker when switching projects; render with reactive data

  if (!project) {
    return (
      <div>
        <button onClick={onBack}>Back</button>
        <div>Project not found.</div>
      </div>
    );
  }

  const createTask = () => {
    onCreateTaskViaPalette(projectId);
  };

  const updateProjectName = (next) => {
    Meteor.call('projects.update', projectId, { name: next });
  };

  const updateProjectDescription = (next) => {
    Meteor.call('projects.update', projectId, { description: next });
  };

  const updateTaskTitle = (taskId, next) => {
    Meteor.call('tasks.update', taskId, { title: next });
  };

  const updateTaskDeadline = (taskId, next) => {
    const parsed = next ? new Date(next) : null;
    Meteor.call('tasks.update', taskId, { deadline: parsed });
  };

  const removeTask = (taskId) => {
    // Prevent layout jump: remove from local order immediately, server update follows
    setOrder(prev => prev.filter(id => id !== taskId));
    Meteor.call('tasks.remove', taskId);
  };

  const deleteProject = () => setShowDeleteModal(true);
  const confirmDeleteProject = () => {
    Meteor.call('projects.remove', projectId, (err) => {
      setShowDeleteModal(false);
      if (err) return;
      if (typeof onBack === 'function') onBack();
    });
  };

  const createNote = () => {
    Meteor.call('notes.insert', { projectId, content: '' });
  };

  const openImproveModal = () => {
    setIsImproveOpen(true);
    setImproveQuestions([]);
    setImproveError('');
    setAnswersText('');
    setIsLoadingImprove(true);
    Meteor.call('ai.project.improvementQuestions', projectId, (err, res) => {
      setIsLoadingImprove(false);
      if (err) {
        console.error('ai.project.improvementQuestions failed', err);
        setImproveError(err && err.message ? err.message : 'Failed to load questions');
        return;
      }
      const qs = Array.isArray(res && res.questions) ? res.questions : [];
      setImproveQuestions(qs);
    });
  };

  const regenerateImproveQuestions = () => {
    setIsLoadingImprove(true);
    setImproveError('');
    Meteor.call('ai.project.improvementQuestions', projectId, (err, res) => {
      setIsLoadingImprove(false);
      if (err) {
        console.error('ai.project.improvementQuestions failed', err);
        setImproveError(err && err.message ? err.message : 'Failed to load questions');
        return;
      }
      const qs = Array.isArray(res && res.questions) ? res.questions : [];
      setImproveQuestions(qs);
    });
  };

  const applyImprovement = () => {
    if (isApplyingImprove) return;
    setIsApplyingImprove(true);
    setImproveError('');
    // Split answers into separate items by blank lines; fallback to lines
    const parts = String(answersText || '')
      .split(/\n\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);
    const answers = parts.length > 0 ? parts : String(answersText || '').split('\n').map(s => s.trim()).filter(Boolean);
    Meteor.call('ai.project.applyImprovement', projectId, { answers }, (err, res) => {
      setIsApplyingImprove(false);
      if (err) {
        console.error('ai.project.applyImprovement failed', err);
        setImproveError(err && err.message ? err.message : 'Failed to apply improvement');
        return;
      }
      setIsImproveOpen(false);
    });
  };

  return (
    <div>
      <Card className="projectHeaderCard" title={null} actions={null}>
        <div className="projectHeaderRow">
          <button
            className={`starBtn${project.isFavorite ? ' active' : ''}`}
            title={project.isFavorite ? 'Unfavorite project' : 'Mark as favorite'}
            onClick={() => {
              const next = !project.isFavorite;
              const modifier = next && (typeof project.favoriteRank === 'undefined' || project.favoriteRank === null)
                ? { isFavorite: true, favoriteRank: Date.now() }
                : { isFavorite: next };
              Meteor.call('projects.update', projectId, modifier);
            }}
          >
            <svg className="starIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
          <h2 className="projectTitle">
            <InlineEditable
              value={project.name}
              placeholder="(untitled project)"
              onSubmit={updateProjectName}
            />
          </h2>
          <div className="projectHeaderRight">
            <button className="btn-link" onClick={openImproveModal} title="Improve project description">Improve description</button>
          </div>
        </div>
        <div className="projectDescription">
          <InlineEditable
            value={project.description}
            placeholder="(add a short description)"
            onSubmit={updateProjectDescription}
            as="textarea"
          />
        </div>
        <div className="projectMeta">
          Status: {
            <InlineEditable
              as="select"
              value={project.status || ''}
              options={[{ value: '', label: 'n/a' }, 'planned', 'active', 'blocked', 'done']}
              onSubmit={(next) => {
                Meteor.call('projects.update', projectId, { status: next || null });
              }}
            />
          }
          {" | "}
          {project.targetDate ? 'Target: ' : null}
          {
            <InlineDate
              value={project.targetDate}
              onSubmit={(next) => {
                const parsed = next ? new Date(next) : null;
                Meteor.call('projects.update', projectId, { targetDate: parsed });
              }}
              placeholder="No target"
            />
          }
          {project.targetDate ? (
            <span className="muted"> · {timeAgo(project.targetDate)}</span>
          ) : null}
          {" | "}
          Progress: {progress}%
          {" | "}
          Color: {
            (() => {
              const safeColor = (typeof project.colorLabel === 'string' && /^#[0-9a-fA-F]{6}$/.test(project.colorLabel)) ? project.colorLabel : '#6b7280';
              return (
                <input
                  type="color"
                  className="colorPickerInput"
                  value={safeColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val)) {
                      Meteor.call('projects.update', projectId, { colorLabel: val });
                    }
                  }}
                  title="Pick a label color"
                />
              );
            })()
          }
          {linkedClaudeProjects.length > 0 && (
            <>
              {" | "}
              {linkedClaudeProjects.map((cp, i) => (
                <span key={cp._id}>
                  {i > 0 && ', '}
                  <a
                    href={`#/claude/${cp._id}`}
                    className="claudeCodeLink"
                    title={`Open Claude project: ${cp.name}`}
                  >Claude Code: {cp.name}</a>
                </span>
              ))}
            </>
          )}
        </div>
      </Card>
      {/* Links section */}
      <div className="projectLinksRow">
        <div className="projectLinksList">
          {links.map((l, idx) => (
            <span key={l._id} className="projectLinkItem">
              <LinkItem link={l} startEditing={idx === 0 && (l.name === 'New Link')} hoverActions />
            </span>
          ))}
          {links.length === 0 ? (
            <span className="muted">No links yet</span>
          ) : null}
        </div>
        <div className="projectLinksActions">
          <button className="btn btn-primary" onClick={() => createNewLink(projectId)}>Add Link</button>
        </div>
      </div>

      {/* Files section */}
      <div className="projectLinksRow">
        <div className="projectLinksList">
          {files.map((f, idx) => (
            <span key={f._id} className="projectFileItem">
              <FileItem file={f} startEditing={false} hoverActions />
            </span>
          ))}
          {files.length === 0 ? (
            <span className="muted">No files yet</span>
          ) : null}
        </div>
        <div className="projectLinksActions">
          <label className="btn btn-primary">
            Upload File
            <input type="file" style={{ display: 'none' }} onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = String(reader.result || '').split(',').pop() || '';
                const name = file.name.replace(/\.[^.]+$/, '');
                Meteor.call('files.insert', { projectId, name, originalName: file.name, contentBase64: base64, mimeType: file.type }, () => {});
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }} />
          </label>
        </div>
      </div>

      {/* Activity Summary Section */}
      <div className="projectActivitySummary">
        <Collapsible title="Activity Summary" defaultOpen={false}>
          <ActivitySummary
            projectFilters={{ [projectId]: 1 }}
            windowKey="7d"
            showProjectFilter={false}
            title={`Activity for ${project.name || '(untitled project)'}`}
          />
        </Collapsible>
      </div>

      {/* Members section (owner only) */}
      {isOwner && (
        <div className="projectMembersSection">
          <Collapsible title={`Members (${members.length})`} defaultOpen={false}>
            <ul className="membersList">
              {members.map(m => {
                const email = m.emails?.[0]?.address || '';
                const displayName = m.username || m.profile?.name || email;
                const isSelf = m._id === project.userId;
                return (
                  <li key={m._id} className="memberItem">
                    <span className="memberName">{displayName}</span>
                    {email && <span className="memberEmail muted"> ({email})</span>}
                    {isSelf ? (
                      <span className="memberBadge">Owner</span>
                    ) : (
                      <button
                        className="btn btn-small"
                        onClick={() => {
                          Meteor.call('projects.removeMember', projectId, m._id, (err) => {
                            if (err) setMemberError(err.reason || err.message);
                          });
                        }}
                      >Remove</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="addMemberRow">
              <input
                type="email"
                className="addMemberInput"
                placeholder="Email address"
                value={memberEmail}
                onChange={(e) => { setMemberEmail(e.target.value); setMemberError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && memberEmail.trim()) {
                    e.preventDefault();
                    setAddingMember(true);
                    setMemberError('');
                    Meteor.call('projects.addMember', projectId, memberEmail.trim(), (err) => {
                      setAddingMember(false);
                      if (err) {
                        setMemberError(err.reason || err.message);
                      } else {
                        setMemberEmail('');
                      }
                    });
                  }
                }}
              />
              <button
                className="btn btn-primary"
                disabled={addingMember || !memberEmail.trim()}
                onClick={() => {
                  setAddingMember(true);
                  setMemberError('');
                  Meteor.call('projects.addMember', projectId, memberEmail.trim(), (err) => {
                    setAddingMember(false);
                    if (err) {
                      setMemberError(err.reason || err.message);
                    } else {
                      setMemberEmail('');
                    }
                  });
                }}
              >{addingMember ? 'Adding...' : 'Add'}</button>
            </div>
            {memberError && <div className="memberError">{memberError}</div>}
          </Collapsible>
        </div>
      )}

      <h3 className="tasksHeader">Tasks</h3>
      <div className="projectActions">
        <button className="btn btn-primary" onClick={createTask}>Add Task</button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="tasksList">
            {order.map(id => {
              const t = activeTasks.find(x => x._id === id);
              if (!t) return null;
              return (
                <SortableRow key={t._id} task={t}>
                  <TaskRow
                    as="div"
                    task={t}
                    showProject={false}
                    allowProjectChange
                    showMoveProjectButton
                    projectOptions={projectOptions}
                    onMoveProject={(projectId) => Meteor.call('tasks.update', t._id, { projectId })}
                    showStatusSelect
                    showDeadline
                    editableDeadline
                    showClearDeadline
                    showDelete
                    showUrgentImportant
                    inlineActions={false}
                    titleClassName={t.deadline ? (deadlineSeverity(t.deadline) || '') : ''}
                    onUpdateStatus={(next) => Meteor.call('tasks.update', t._id, { status: next })}
                    onUpdateTitle={(next) => updateTaskTitle(t._id, next)}
                    onUpdateDeadline={(next) => updateTaskDeadline(t._id, next)}
                    onClearDeadline={() => updateTaskDeadline(t._id, '')}
                    onRemove={() => removeTask(t._id)}
                    onToggleUrgent={(task) => Meteor.call('tasks.update', task._id, { isUrgent: !task.isUrgent })}
                    onToggleImportant={(task) => Meteor.call('tasks.update', task._id, { isImportant: !task.isImportant })}
                  />
                </SortableRow>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>

      <h3 className="tasksHeader">Notes</h3>
      <div className="projectActions">
        <button className="btn btn-primary" onClick={createNote}>Add Note</button>
        <button className="btn btn-primary ml8" onClick={() => onOpenNoteSession(projectId)}>New Note Session</button>
      </div>
      {notes.length === 0 ? (
        <div>No notes yet.</div>
      ) : (
        <ul>
          {notes.map(n => {
            const headerTitleNode = (
              <InlineEditable
                value={n.title || ''}
                placeholder="(untitled note)"
                onSubmit={(next) => {
                  const title = String(next || '').trim();
                  Meteor.call('notes.update', n._id, { title });
                }}
                fullWidth
              />
            );
            return (
            <li key={n._id}>
              <div className="noteBlock">
                <Collapsible title={headerTitleNode}>
                  <div className="noteBlockHeader">
                    <div className="noteMeta">Created {timeAgo(n.createdAt)} · {new Date(n.createdAt).toLocaleString()}</div>
                    <div className="noteActions" title="Actions">
                      <Tooltip content="Clean note (AI)">
                        <button
                          className="btn"
                          disabled={!!cleaningNoteIds[n._id]}
                          onClick={() => {
                            const key = `note:original:${n._id}`;
                            const has = typeof window !== 'undefined' ? sessionStorage.getItem(key) : null;
                            const hadBackup = !!has;
                            if (!hadBackup && typeof window !== 'undefined') {
                              sessionStorage.setItem(key, n.content || '');
                            }
                            setCleaningNoteIds(prev => ({ ...prev, [n._id]: true }));
                            Meteor.call('ai.cleanNote', n._id, (err) => {
                              setCleaningNoteIds(prev => ({ ...prev, [n._id]: false }));
                              if (err) {
                                console.error('ai.cleanNote failed', err);
                                if (!hadBackup && typeof window !== 'undefined') {
                                  sessionStorage.removeItem(key);
                                }
                                setUndoAvailable(prev => ({ ...prev, [n._id]: false }));
                                return;
                              }
                              setUndoAvailable(prev => ({ ...prev, [n._id]: true }));
                            });
                          }}
                        >{cleaningNoteIds[n._id] ? 'Cleaning…' : 'Clean'}</button>
                      </Tooltip>
                      <Tooltip content="Open in note editor">
                        <button
                          className="btn ml8"
                          onClick={() => navigateTo({ name: 'notes', noteId: n._id })}
                        >Open in note editor</button>
                      </Tooltip>
                      <Tooltip content="Undo last clean">
                        <button
                          className="btn ml8"
                          disabled={!undoAvailable[n._id]}
                          onClick={() => {
                            const key = `note:original:${n._id}`;
                            const original = typeof window !== 'undefined' ? sessionStorage.getItem(key) : null;
                            if (!original) {
                              setUndoAvailable(prev => ({ ...prev, [n._id]: false }));
                              return;
                            }
                            Meteor.call('notes.update', n._id, { content: original }, () => {
                              if (typeof window !== 'undefined') sessionStorage.removeItem(key);
                              setUndoAvailable(prev => ({ ...prev, [n._id]: false }));
                            });
                          }}
                        >Undo</button>
                      </Tooltip>
                      <Tooltip content="Delete note">
                        <button className="iconButton" onClick={() => setNoteToDeleteId(n._id)}>🗑</button>
                      </Tooltip>
                    </div>
                  </div>
                  {n.kind === 'aiSummary' ? (
                    <InlineEditable
                      as="textarea"
                      value={n.content}
                      placeholder="(empty)"
                      startEditing={n.content === ''}
                      selectAllOnFocus
                      rows={12}
                      inputClassName="projectNoteTextarea"
                      onSubmit={(next) => {
                        Meteor.call('notes.update', n._id, { content: next });
                      }}
                    />
                  ) : (
                    <InlineEditable
                      as="textarea"
                      value={n.content}
                      placeholder="(empty)"
                      startEditing={n.content === ''}
                      selectAllOnFocus
                      rows={12}
                      inputClassName="projectNoteTextarea"
                      onSubmit={(next) => {
                        Meteor.call('notes.update', n._id, { content: next });
                      }}
                    />
                  )}
                </Collapsible>
              </div>
            </li>
          );})}
        </ul>
      )}

      <h3 className="tasksHeader">Note Sessions</h3>
      {sessions.length === 0 ? (
        <div>No sessions yet.</div>
      ) : (
        <ul>
          {sessions.map(s => (
            <li key={s._id}>
              <button className="btn" onClick={() => navigateTo({ name: 'session', sessionId: s._id })}>
                {s.name ? s.name : new Date(s.createdAt).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      )}

      {doneTasks.length > 0 ? (
        <div className="doneSection">
          <h3 className="tasksHeader doneHeader">
            <button className="btn-link" onClick={() => setShowDone(v => !v)} aria-expanded={showDone} aria-controls="doneTasksList">
              {showDone ? '▼' : '▶'} Done tasks ({doneTasks.length})
            </button>
          </h3>
          {showDone ? (
            <ul id="doneTasksList" className="tasksList">
              {doneTasks.map(t => (
                <li key={t._id} className={(t.status || 'todo') === 'done' ? 'taskDone' : ''}>
                  <TaskRow
                    as="div"
                    task={t}
                    showProject={false}
                    allowProjectChange
                    showMoveProjectButton
                    projectOptions={projectOptions}
                    onMoveProject={(projectId) => Meteor.call('tasks.update', t._id, { projectId })}
                    showStatusSelect
                    showDeadline
                    editableDeadline
                    showClearDeadline={false}
                    showDelete
                    showUrgentImportant={false}
                    inlineActions={false}
                    titleClassName={t.deadline ? (deadlineSeverity(t.deadline) || '') : ''}
                    onUpdateStatus={(next) => Meteor.call('tasks.update', t._id, { status: next })}
                    onUpdateTitle={(next) => updateTaskTitle(t._id, next)}
                    onUpdateDeadline={(next) => updateTaskDeadline(t._id, next)}
                    onRemove={() => removeTask(t._id)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="projectDeleteFooter">
        <button className="btn-link" onClick={() => navigateTo({ name: 'projectDelete', projectId })}>Delete Project…</button>
      </div>
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={`Delete project ${project.name || '(untitled)'}`}
        actions={[
          <button key="cancel" className="btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>,
          <button key="del" className="btn btn-danger" onClick={confirmDeleteProject}>Delete</button>
        ]}
      >
        <div>Delete this project and all its tasks and sessions? This cannot be undone.</div>
      </Modal>

      {/* Improve Description Modal */}
      <Modal
        open={isImproveOpen}
        onClose={() => setIsImproveOpen(false)}
        title={`Improve description · ${project.name || '(untitled)'}`}
      >
        <div className="mb16">
          {isLoadingImprove ? (
            <div>Generating questions…</div>
          ) : improveError ? (
            <div className="errorText">{improveError}</div>
          ) : (
            <div>
              {improveQuestions && improveQuestions.length > 0 ? (
                <ol className="mb16">
                  {improveQuestions.map((q, i) => (
                    <li key={i} className="mb8">{q}</li>
                  ))}
                </ol>
              ) : (
                <div className="muted mb16">No questions. You can still share context below.</div>
              )}
              <button className="btn ml0 mb16" onClick={regenerateImproveQuestions}>Regenerate questions</button>
              <div className="mb8">Your answers and context (free text). Use paragraphs; one answer per paragraph.</div>
              <textarea
                className="projectNoteTextarea"
                rows={10}
                value={answersText}
                placeholder="Answer here…"
                onChange={(e) => setAnswersText(e.target.value)}
              />
              <div className="modalFooter mt16">
                <button className="btn" onClick={() => setIsImproveOpen(false)}>Cancel</button>
                <button className="btn btn-primary ml8" disabled={isApplyingImprove} onClick={applyImprovement}>
                  {isApplyingImprove ? 'Applying…' : 'Apply improvement'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!noteToDeleteId}
        onClose={() => setNoteToDeleteId(null)}
        title="Delete note"
        actions={[
          <button key="cancel" className="btn" onClick={() => setNoteToDeleteId(null)}>Cancel</button>,
          <button key="del" className="btn btn-danger" onClick={() => {
            const id = noteToDeleteId;
            if (!id) return;
            Meteor.call('notes.remove', id, (err) => {
              setNoteToDeleteId(null);
              if (err) {
                console.error('notes.remove failed', err);
              }
            });
          }}>Delete</button>
        ]}
      >
        <div>This will permanently delete this note from the project.</div>
      </Modal>
    </div>
  );
};

ProjectDetails.propTypes = {
  projectId: PropTypes.string.isRequired,
  onBack: PropTypes.func,
  onOpenNoteSession: PropTypes.func,
  onCreateTaskViaPalette: PropTypes.func,
};


