import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { ClaudeProjectsCollection } from '../../api/claudeProjects/collections';
import { Collapsible } from '../components/Collapsible/Collapsible.jsx';
import { Modal } from '../components/Modal/Modal.jsx';
import { ActivitySummary } from '../components/ActivitySummary/ActivitySummary.jsx';
import { NotesPanel } from '../Notes/NotesPanel/NotesPanel.jsx';

/** Return '#000' or '#fff' depending on which has better contrast against hex color */
function contrastText(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // sRGB relative luminance (WCAG formula)
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.4 ? '#000' : '#fff';
}

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

export const ProjectDetails = ({ projectId, onBack, onOpenNoteSession, onCreateTaskViaPalette }) => {
  const _loadProjects = useSubscribe('projects');
  const _loadTasks = useSubscribe('tasks');
  const _loadSessions = useSubscribe('noteSessions');
  const _loadNotes = useSubscribe('notes');
  const _loadLinks = useSubscribe('links.byProject', projectId);
  const _loadFiles = useSubscribe('files.byProject', projectId);
  const _loadClaudeProjects = useSubscribe('claudeProjects');
  const _loadMembers = useSubscribe('projectMembers', projectId);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    .sort((a,b) => new Date((b.statusChangedAt || 0)) - new Date((a.statusChangedAt || 0))), [tasks, tasks && tasks.map(t => t.status || '').join(','), projectId]);
  // DnD setup for active tasks
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [order, setOrder] = useState([]);
  const activeTaskIds = useMemo(() => activeTasks.map(t => t._id), [activeTasks]);
  React.useEffect(() => { setOrder(activeTaskIds); }, [activeTaskIds]);

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
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Color picker: local state + debounced save
  const [localColor, setLocalColor] = useState(null);
  const colorTimerRef = useRef(null);
  const displayColor = localColor ?? project?.colorLabel ?? null;
  const onColorChange = useCallback((e) => {
    const val = e.target.value;
    if (typeof val !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(val)) return;
    setLocalColor(val);
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    colorTimerRef.current = setTimeout(() => {
      Meteor.call('projects.update', projectId, { colorLabel: val });
      setLocalColor(null);
    }, 600);
  }, [projectId]);

  // Members state
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [activeTab, setActiveTab] = useState('notes');
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
    Meteor.call('ai.project.applyImprovement', projectId, { answers }, (err, _res) => {
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
    <div className="project-details">
      <Card className="projectHeaderCard" title={null} actions={null}>
        <div className="pd-hero" style={displayColor ? { '--project-color': displayColor, '--project-text': contrastText(displayColor) } : undefined}>
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
          <div className="projectMeta">
            <span className="pd-meta-badge">
              <span className="pd-meta-label">Status</span>
              <InlineEditable
                as="select"
                value={project.status || ''}
                options={[{ value: '', label: 'n/a' }, 'planned', 'active', 'blocked', 'done']}
                onSubmit={(next) => {
                  Meteor.call('projects.update', projectId, { status: next || null });
                }}
              />
            </span>
            <span className="pd-meta-badge">
              <span className="pd-meta-label">Target</span>
              <InlineDate
                value={project.targetDate}
                onSubmit={(next) => {
                  const parsed = next ? new Date(next) : null;
                  Meteor.call('projects.update', projectId, { targetDate: parsed });
                }}
                placeholder="No target"
              />
              {project.targetDate ? (
                <span className="muted"> · {timeAgo(project.targetDate)}</span>
              ) : null}
            </span>
            <span className="pd-meta-badge">
              <span className="pd-meta-label">Color</span>
              <input
                type="color"
                className="colorPickerInput"
                value={displayColor || '#6b7280'}
                onInput={onColorChange}
                title="Pick a label color"
              />
            </span>
            {linkedClaudeProjects.length > 0 && linkedClaudeProjects.map((cp) => (
              <a
                key={cp._id}
                href={`#/claude/${cp._id}`}
                className="claudeCodeLink"
                title={`Open Claude project: ${cp.name}`}
              >Claude Code: {cp.name}</a>
            ))}
          </div>
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
        </div>
      </Card>

      <div className="pd-tabs" role="tablist">
        {[
          { key: 'notes', label: 'Notes', icon: '\u270E', count: notes.length },
          { key: 'tasks', label: 'Tasks', icon: '\u2713', count: activeTasks.length },
          { key: 'sessions', label: 'Sessions', icon: '\u{1F4CB}', count: sessions.length },
          { key: 'resources', label: 'Resources', icon: '\u{1F517}', count: links.length + files.length },
          { key: 'settings', label: 'Settings', icon: '\u2699' },
        ].map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`pd-tabs__tab${activeTab === tab.key ? ' pd-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="pd-tabs__icon">{tab.icon}</span>
            {tab.label}
            {tab.count !== null && tab.count !== undefined && tab.count > 0 && <span className="pd-tabs__count">{tab.count}</span>}
          </button>
        ))}
        <div className="pd-tabs__actions">
          {activeTab === 'tasks' && <button className="btn btn-primary btn-sm" onClick={createTask}>Add Task</button>}
          {activeTab === 'sessions' && <button className="btn btn-primary btn-sm" onClick={() => onOpenNoteSession(projectId)}>New Session</button>}
          {activeTab === 'resources' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => createNewLink(projectId)}>Add Link</button>
              <label className="btn btn-sm">
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
            </>
          )}
        </div>
      </div>

      <div className="pd-tab-content">
        {activeTab === 'tasks' && (
          <>
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
          </>
        )}

        {activeTab === 'notes' && (
          <div className="pd-notes-container">
            <NotesPanel
              projectId={projectId}
              storageKey={`project-${projectId}-notes`}
              showProjectColumn={false}
              showMoveProject={false}
            />
          </div>
        )}

        {activeTab === 'sessions' && (
          <>
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
          </>
        )}

        {activeTab === 'resources' && (
          <>
            {links.length > 0 && (
              <div className="projectLinksRow">
                <div className="projectLinksList">
                  {links.map((l, idx) => (
                    <span key={l._id} className="projectLinkItem">
                      <LinkItem link={l} startEditing={idx === 0 && (l.name === 'New Link')} hoverActions />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {files.length > 0 && (
              <div className="projectLinksRow">
                <div className="projectLinksList">
                  {files.map((f) => (
                    <span key={f._id} className="projectFileItem">
                      <FileItem file={f} startEditing={false} hoverActions />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {links.length === 0 && files.length === 0 && (
              <p className="muted">No resources yet. Use the buttons above to add links or upload files.</p>
            )}
          </>
        )}

        {activeTab === 'settings' && (
          <>
            {isOwner && (
              <div className="pd-settings-section">
                <h4 className="pd-settings-section__title">Team</h4>
                <div className="pd-team-list">
                  {members.map(m => {
                    const email = m.emails?.[0]?.address || '';
                    const displayName = m.username || m.profile?.name || email;
                    const isSelf = m._id === project.userId;
                    const initials = displayName.split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?';
                    const hue = displayName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 6;
                    return (
                      <div key={m._id} className="pd-member">
                        <div className="pd-member__avatar" data-hue={hue}>
                          {initials}
                        </div>
                        <div className="pd-member__info">
                          <span className="pd-member__name">
                            {displayName}
                            {isSelf && <span className="pd-member__role">Owner</span>}
                          </span>
                          {email && <span className="pd-member__email">{email}</span>}
                        </div>
                        {!isSelf && (
                          <button
                            className="pd-member__remove"
                            title="Remove member"
                            onClick={() => {
                              Meteor.call('projects.removeMember', projectId, m._id, (err) => {
                                if (err) setMemberError(err.reason || err.message);
                              });
                            }}
                          >Remove</button>
                        )}
                      </div>
                    );
                  })}
                  {members.length === 0 && <div className="pd-team-list__empty">No members yet</div>}
                </div>
                <div className="pd-team-invite">
                  <div className="pd-team-invite__row">
                    <input
                      type="email"
                      className="pd-invite__input"
                      placeholder="Invite by email..."
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
                    >{addingMember ? 'Inviting...' : 'Invite'}</button>
                  </div>
                  {memberError && <div className="pd-invite__error">{memberError}</div>}
                </div>
              </div>
            )}

            <div className="pd-settings-section">
              <Collapsible title="Activity Summary" defaultOpen={false}>
                <ActivitySummary
                  projectFilters={{ [projectId]: 1 }}
                  windowKey="7d"
                  showProjectFilter={false}
                  excludeTypes={['project_created']}
                  title={`Activity for ${project.name || '(untitled project)'}`}
                />
              </Collapsible>
            </div>

            <button className="btn btn-danger pd-delete-btn" onClick={deleteProject}>Delete Project…</button>
          </>
        )}
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

    </div>
  );
};

ProjectDetails.propTypes = {
  projectId: PropTypes.string.isRequired,
  onBack: PropTypes.func,
  onOpenNoteSession: PropTypes.func,
  onCreateTaskViaPalette: PropTypes.func,
};
