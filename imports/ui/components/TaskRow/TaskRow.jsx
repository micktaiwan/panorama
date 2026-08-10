import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import PropTypes from 'prop-types';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import { formatDate, formatDateTime, deadlineSeverity, SNOOZE_PRESETS, snoozeDateFor, isSnoozed } from '/imports/ui/utils/date.js';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import './TaskRow.css';

const EMPTY_ARRAY = [];

// Avatar helpers (kept in sync with the project members list)
const initialsFor = (name) => name.split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?';
const hueFor = (name) => name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 6;

export const TaskRow = ({
  as = 'li',
  task,
  // Project context (optional)
  projectName,
  projectColor,
  projectHref,
  showProject = false,
  allowProjectChange = false,
  projectOptions = EMPTY_ARRAY,
  onMoveProject,
  showMoveProjectButton = false,
  projectColWidth,
  colGap,
  // Controls
  showStatusSelect = true,
  showDeadline = true,
  showClearDeadline = true,
  showDelete = true,
  showSnooze = false,
  showMarkDone = false,
  showUrgentImportant = false,
  editableDeadline = false,
  // Assignee (optional)
  showAssignee = false,
  memberOptions = EMPTY_ARRAY,
  // Tags (optional)
  showTags = false,
  tagSuggestions = EMPTY_ARRAY,
  // Typography
  textSize = 'normal', // 'normal' | 'small'
  // Layout
  inlineActions = false,
  titleClassName = '',
  // Handlers
  onUpdateStatus,
  onUpdateTitle,
  onUpdateDeadline,
  onClearDeadline,
  onRemove,
  onMarkDone,
  onToggleUrgent,
  onToggleImportant,
  onUpdateAssignee,
  onUpdateTags
}) => {
  const Container = as || 'li';
  const [showMoveSelect, setShowMoveSelect] = React.useState(false);
  // Notes modal state
  const [isNotesOpen, setIsNotesOpen] = React.useState(false);
  const [notesDraft, setNotesDraft] = React.useState('');
  // Tag editing state
  const [tagDraft, setTagDraft] = React.useState('');
  const [addingTag, setAddingTag] = React.useState(false);
  // Snooze menu state. The menu is positioned as a fixed overlay so it is not
  // clipped by the scrollable task lists it lives in.
  const [snoozeOpen, setSnoozeOpen] = React.useState(false);
  const [snoozeMenuPos, setSnoozeMenuPos] = React.useState(null);
  const snoozeRef = React.useRef(null);
  const snoozeBtnRef = React.useRef(null);
  React.useEffect(() => {
    if (!snoozeOpen) return undefined;
    const close = () => setSnoozeOpen(false);
    const onDocMouseDown = (e) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target)) close();
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    // A fixed overlay would drift away from its button on scroll/resize
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [snoozeOpen]);
  // Resolve the assignee's display name + whether it is the current user
  // (network users are published app-wide via users.network)
  const assignee = useTracker(() => {
    const id = task?.assigneeId;
    if (!id) return { name: '', isMe: false };
    const u = Meteor.users.findOne(id, { fields: { username: 1, profile: 1, emails: 1 } });
    const name = u ? (u.username || u.profile?.name || u.emails?.[0]?.address || '') : '';
    return { name, isMe: id === Meteor.userId() };
  }, [task?.assigneeId]);
  if (!task) return null;
  const assigneeName = assignee.name;
  const assignedToMe = assignee.isMe;
  const status = task.status || 'todo';
  const sev = task.deadline ? deadlineSeverity(task.deadline) : '';
  const metaCls = sev ? ` ${sev}` : ' taskMetaDefault';
  const containerStyle = {
    ...(projectColWidth ? { ['--task-project-col-width']: projectColWidth } : {}),
    ...(colGap ? { ['--task-col-gap']: colGap } : {}),
  };

  const openNotes = () => {
    setNotesDraft(task?.notes || '');
    setIsNotesOpen(true);
  };

  const saveNotes = () => {
    const next = notesDraft;
    if (task?._id) Meteor.call('tasks.update', task._id, { notes: next });
    setIsNotesOpen(false);
  };

  const canEditAssignee = showAssignee && typeof onUpdateAssignee === 'function' && Array.isArray(memberOptions) && memberOptions.length > 0;
  const assigneeChip = assigneeName ? (
    <span className="taskAssignee" data-hue={hueFor(assigneeName)}>{initialsFor(assigneeName)}</span>
  ) : null;
  const assigneeEl = (() => {
    // Read-only contexts: only show when assigned
    if (!canEditAssignee) {
      if (!assigneeChip) return null;
      return (<Tooltip content={`Assignee: ${assigneeName}`}>{assigneeChip}</Tooltip>);
    }
    // The native select is overlaid on the chip, so the tooltip has to wrap
    // both: hovering the row never reaches the chip itself.
    return (
      <Tooltip content={assigneeName ? `Assignee: ${assigneeName}` : 'Assign to…'}>
        <span className="taskAssigneeEdit">
          {assigneeChip || (<span className="taskAssignee taskAssigneeAdd">+</span>)}
          <select
            className="taskAssigneeNativeSelect"
            value={task.assigneeId || ''}
            onChange={(e) => onUpdateAssignee(e.target.value || null)}
            aria-label="Assign to"
          >
            <option value="">(no assignee)</option>
            {memberOptions.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </span>
      </Tooltip>
    );
  })();

  // Tags: free-text labels stored as an array of strings on the task
  const tags = Array.isArray(task.tags) ? task.tags : EMPTY_ARRAY;
  const canEditTags = showTags && typeof onUpdateTags === 'function';
  const addTag = (raw) => {
    const t = String(raw || '').trim();
    if (!t) return;
    if (tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
    onUpdateTags([...tags, t]);
  };
  const removeTag = (t) => onUpdateTags(tags.filter(x => x !== t));
  const tagListId = `tags-${task._id || 'new'}`;
  // Add-tag trigger lives in the inline actions row (line 1) so an empty task
  // never reserves a second line just for the "+" affordance.
  const tagAddButton = canEditTags ? (
    <Tooltip content="Add tag">
      <button type="button" className="iconButton taskTagAddBtn" aria-label="Add tag" onClick={() => setAddingTag(true)}>#</button>
    </Tooltip>
  ) : null;
  // Chips (+ inline input while adding) render on their own line under the
  // title, and only when there is something to show.
  const tagsEl = (showTags && (tags.length > 0 || addingTag)) ? (
    <span className="taskTags">
      {tags.map(t => (
        <span key={t} className="taskTag" data-hue={hueFor(t)}>
          {t}
          {canEditTags ? (
            <Tooltip content="Remove tag">
              <button type="button" className="taskTagRemove" aria-label="Remove tag" onClick={() => removeTag(t)}>×</button>
            </Tooltip>
          ) : null}
        </span>
      ))}
      {canEditTags && addingTag ? (
        <input
          className="taskTagInput"
          autoFocus
          value={tagDraft}
          list={tagListId}
          placeholder="tag…"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft); setTagDraft(''); }
            else if (e.key === 'Escape') { setAddingTag(false); setTagDraft(''); }
          }}
          onBlur={() => { addTag(tagDraft); setTagDraft(''); setAddingTag(false); }}
        />
      ) : null}
      {canEditTags && Array.isArray(tagSuggestions) && tagSuggestions.length > 0 ? (
        <datalist id={tagListId}>
          {tagSuggestions.map(s => (<option key={s} value={s} />))}
        </datalist>
      ) : null}
    </span>
  ) : null;

  // Snooze: hides the task from the main list until its wake-up date
  const snoozed = isSnoozed(task);
  const applySnooze = (key) => {
    const until = snoozeDateFor(key);
    if (!until) return;
    setSnoozeOpen(false);
    Meteor.call('tasks.snooze', task._id, until);
  };
  const wakeUpNow = () => {
    setSnoozeOpen(false);
    Meteor.call('tasks.snooze', task._id, null);
  };
  // Anchor the fixed menu under the button, flipping above when the viewport
  // has no room below.
  const SNOOZE_MENU_WIDTH = 180;
  const toggleSnoozeMenu = () => {
    if (snoozeOpen) { setSnoozeOpen(false); return; }
    const rect = snoozeBtnRef.current?.getBoundingClientRect();
    if (rect) {
      const height = 40 + (SNOOZE_PRESETS.length + (snoozed ? 1 : 0)) * 30;
      const left = Math.max(8, Math.min(rect.right - SNOOZE_MENU_WIDTH, window.innerWidth - SNOOZE_MENU_WIDTH - 8));
      const top = (window.innerHeight - rect.bottom >= height + 8)
        ? rect.bottom + 4
        : Math.max(8, rect.top - height - 4);
      setSnoozeMenuPos({ top, left });
    }
    setSnoozeOpen(true);
  };
  const snoozeEl = showSnooze ? (
    <span className="taskSnooze" ref={snoozeRef}>
      <Tooltip content={snoozed ? `Snoozed until ${formatDateTime(task.snoozedUntil)}` : 'Snooze task'}>
        <button
          type="button"
          ref={snoozeBtnRef}
          className={`iconButton taskSnoozeBtn${snoozed ? ' snoozed' : ''}`}
          aria-label="Snooze task"
          aria-expanded={snoozeOpen ? 'true' : 'false'}
          onClick={toggleSnoozeMenu}
        >💤</button>
      </Tooltip>
      {snoozeOpen ? (
        <div
          className="taskSnoozeMenu"
          role="menu"
          style={{
            ['--snooze-menu-top']: `${snoozeMenuPos?.top ?? 0}px`,
            ['--snooze-menu-left']: `${snoozeMenuPos?.left ?? 0}px`,
            ['--snooze-menu-width']: `${SNOOZE_MENU_WIDTH}px`
          }}
        >
          {SNOOZE_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              role="menuitem"
              className="taskSnoozeItem"
              onClick={() => applySnooze(p.key)}
            >{p.label}</button>
          ))}
          {snoozed ? (
            <button type="button" role="menuitem" className="taskSnoozeItem wake" onClick={wakeUpNow}>Wake up now</button>
          ) : null}
        </div>
      ) : null}
    </span>
  ) : null;

  return (
    <Container className={`taskRowC${status === 'in_progress' ? ' inProgress' : ''}${showProject ? ' withProject' : ''}${textSize === 'small' ? ' smallText' : ''}${inlineActions ? ' inlineActions' : ''}${assignedToMe ? ' assignedToMe' : ''}${snoozed ? ' snoozedRow' : ''}`} style={containerStyle}>
      <div className="taskLeft">
        {assigneeEl}
        {showMarkDone ? (
          <Tooltip content="Mark as done">
            <input
              type="checkbox"
              className="taskCheck"
              aria-label="Mark as done"
              onChange={(e) => { if (e.target.checked && typeof onMarkDone === 'function') onMarkDone(task); }}
            />
          </Tooltip>
        ) : null}
        {showProject ? (() => {
          if (allowProjectChange) {
            const options = [{ value: '', label: '(no project)' }, ...((Array.isArray(projectOptions) ? projectOptions : []))];
            return (
              <InlineEditable
                as="select"
                value={task.projectId || ''}
                options={options}
                className="taskProjectLink"
                inputClassName="taskProjectLink"
                onSubmit={(next) => {
                  const val = next || '';
                  if (typeof onMoveProject === 'function') onMoveProject(val || null);
                }}
              />
            );
          }
          if (projectHref) {
            return (
              <a href={projectHref} className="taskProjectLink">
                <svg className="projFlag" viewBox="0 0 16 16" aria-hidden="true">
                  <path fill={projectColor || '#6b7280'} d="M2 2v12h2V9h5l1 1h4V3h-3l-1-1H4V2H2z" />
                </svg>
                {projectName || 'Open project'}
              </a>
            );
          }
          return (<span className="taskProjectLink">—</span>);
        })() : null}
      </div>
      <div className={`taskMain${!showStatusSelect ? ' noStatus' : ''}${inlineActions ? ' inline' : ''}`}>
        {showStatusSelect ? (
          <span className="taskStatusCol">
            <InlineEditable
              as="select"
              value={status}
              options={[
                { value: 'todo', label: 'to do' },
                { value: 'in_progress', label: 'in progress' },
                { value: 'done', label: 'done' },
                { value: 'cancelled', label: 'cancelled' },
                { value: 'idea', label: 'idea' }
              ]}
              onSubmit={(next) => { if (typeof onUpdateStatus === 'function') onUpdateStatus(next); }}
            />
          </span>
        ) : null}
        <div className="taskTitleArea">
          <InlineEditable
            value={task.title || ''}
            placeholder="(untitled task)"
            fullWidth
            className={`${titleClassName || ''}${status === 'in_progress' ? ' inProgress' : ''}`}
            inputClassName={`taskRowTitle${status === 'in_progress' ? ' inProgress' : ''}`}
            onSubmit={(next) => { onUpdateTitle?.(String(next || '').trim()); }}
          />
          {snoozed ? (
            <Tooltip content={`Snoozed until ${formatDateTime(task.snoozedUntil)}`}>
              <span className="taskSnoozedChip">
                💤 {formatDateTime(task.snoozedUntil)}
              </span>
            </Tooltip>
          ) : null}
          {Number.isFinite(task.priorityRank) ? (
            <Tooltip content={`Priority rank: ${task.priorityRank}`}>
              <span className="taskRankDebug">
                #{task.priorityRank}
              </span>
            </Tooltip>
          ) : null}
          <span className="taskInlineActions">
            {inlineActions && showUrgentImportant ? (
              <>
                <Tooltip content="Toggle urgent">
                  <button
                    className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
                    aria-pressed={!!task.isUrgent}
                    onClick={() => onToggleUrgent?.(task)}
                  >urgent</button>
                </Tooltip>
                <Tooltip content="Toggle important">
                  <button
                    className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
                    aria-pressed={!!task.isImportant}
                    onClick={() => onToggleImportant?.(task)}
                  >important</button>
                </Tooltip>
              </>
            ) : null}
            <Tooltip content={task.notes || 'Add notes'} size={task.notes ? 'large' : 'normal'}>
              <button className={`iconButton taskNotesButton${task.notes ? ' hasNotes' : ''}`} aria-label="Notes" onClick={openNotes}>…</button>
            </Tooltip>
            {tagAddButton}
          </span>
          {task.notes ? (
            <Tooltip content={task.notes} size="large" className="taskNotesTip">
              <button
                type="button"
                className="taskNotes taskNotesClickable"
                onClick={openNotes}
              >{task.notes}</button>
            </Tooltip>
          ) : null}
          {tagsEl}
        </div>
      </div>
      {!inlineActions ? (
      <div className="taskRight">
        {!showProject && allowProjectChange && showMoveProjectButton ? (
          <span className="taskActions" style={{ marginRight: 8 }}>
            {showMoveSelect ? (
              <>
                <select
                  className="taskProjectLink"
                  value={task.projectId || ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    onMoveProject?.(val);
                    setShowMoveSelect(false);
                  }}
                  aria-label="Move to project"
                >
                  <option value="">(no project)</option>
                  {(Array.isArray(projectOptions) ? projectOptions : []).map((o) => {
                    const value = o?.value ? o.value : '';
                    const label = o?.label ? o.label : '';
                    return (<option key={value || '__none__'} value={value}>{label}</option>);
                  })}
                </select>
                <Tooltip content="Cancel">
                  <button className="iconButton" aria-label="Cancel" onClick={() => setShowMoveSelect(false)}>✕</button>
                </Tooltip>
              </>
            ) : (
              <Tooltip content="Move to project">
                <button className="iconButton" aria-label="Move to project" onClick={() => setShowMoveSelect(true)}>⇄</button>
              </Tooltip>
            )}
          </span>
        ) : null}
        {showDeadline ? (() => {
          if (editableDeadline) {
            return (
              <div>
                {status === 'done' ? (
                  <div className="doneMeta">Done {formatDate(task.statusChangedAt)}</div>
                ) : (
                  <InlineDate
                    value={task.deadline}
                    onSubmit={(next) => { onUpdateDeadline?.(next); }}
                    placeholder="No deadline"
                  />
                )}
              </div>
            );
          }
          return (
            <div className={`taskMeta${metaCls}`}>
              {task.deadline ? `Due ${formatDate(task.deadline)}` : 'No deadline'} · {formatDateTime(task?.createdAt)}
            </div>
          );
        })() : null}
        {showUrgentImportant ? (
          <span className="taskActions">
            <Tooltip content="Toggle urgent">
              <button
                className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
                aria-pressed={!!task.isUrgent}
                onClick={() => onToggleUrgent?.(task)}
              >urgent</button>
            </Tooltip>
            <Tooltip content="Toggle important">
              <button
                className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
                aria-pressed={!!task.isImportant}
                onClick={() => onToggleImportant?.(task)}
              >important</button>
            </Tooltip>
          </span>
        ) : null}
        {snoozeEl}
        <Tooltip content="Promote to top priority">
          <button
            className="iconButton"
            aria-label="Promote to top priority"
            onClick={() => Meteor.call('tasks.promoteToTop', task._id)}
          >↑</button>
        </Tooltip>
        {showClearDeadline && task.deadline ? (
          <Tooltip content="Clear deadline">
            <button className="iconButton" aria-label="Clear deadline" onClick={() => onClearDeadline?.()}>✕</button>
          </Tooltip>
        ) : null}
        {showDelete ? (
          <Tooltip content="Delete task">
            <button className="iconButton" aria-label="Delete task" onClick={() => onRemove?.()}>🗑</button>
          </Tooltip>
        ) : null}
      </div>
      ) : null}
      {/* Notes Modal */}
      {(() => {
        if (!isNotesOpen) return null;
        return (
          <Modal
            open={isNotesOpen}
            onClose={() => setIsNotesOpen(false)}
            title={task?.title ? `Notes · ${task?.title}` : 'Notes'}
            icon={false}
            wide
          >
            <textarea
              className="taskNotesTextarea"
              rows={10}
              value={notesDraft}
              placeholder="Type notes..."
              onChange={(e) => setNotesDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveNotes();
                }
              }}
            />
            <div className="modalFooter">
              <button className="btn btn-primary" onClick={saveNotes}>Save</button>
              <button className="btn ml8" onClick={() => setIsNotesOpen(false)}>Cancel</button>
            </div>
          </Modal>
        );
      })()}
    </Container>
  );
};

TaskRow.propTypes = {
  as: PropTypes.oneOfType([PropTypes.string, PropTypes.elementType]),
  task: PropTypes.shape({
    _id: PropTypes.string,
    title: PropTypes.string,
    notes: PropTypes.string,
    status: PropTypes.string,
    deadline: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    createdAt: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    statusChangedAt: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    snoozedUntil: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    projectId: PropTypes.string,
    assigneeId: PropTypes.string,
    tags: PropTypes.arrayOf(PropTypes.string),
    isUrgent: PropTypes.bool,
    isImportant: PropTypes.bool,
  }).isRequired,
  // Project context (optional)
  projectName: PropTypes.string,
  projectColor: PropTypes.string,
  projectHref: PropTypes.string,
  showProject: PropTypes.bool,
  allowProjectChange: PropTypes.bool,
  projectOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onMoveProject: PropTypes.func,
  showMoveProjectButton: PropTypes.bool,
  // Controls
  showStatusSelect: PropTypes.bool,
  showDeadline: PropTypes.bool,
  showClearDeadline: PropTypes.bool,
  showDelete: PropTypes.bool,
  showSnooze: PropTypes.bool,
  showMarkDone: PropTypes.bool,
  showUrgentImportant: PropTypes.bool,
  editableDeadline: PropTypes.bool,
  // Assignee (optional)
  showAssignee: PropTypes.bool,
  memberOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onUpdateAssignee: PropTypes.func,
  // Tags (optional)
  showTags: PropTypes.bool,
  tagSuggestions: PropTypes.arrayOf(PropTypes.string),
  onUpdateTags: PropTypes.func,
  // Typography
  textSize: PropTypes.oneOf(['normal', 'small']),
  // Layout
  inlineActions: PropTypes.bool,
  titleClassName: PropTypes.string,
  projectColWidth: PropTypes.string,
  colGap: PropTypes.string,
  // Handlers
  onUpdateStatus: PropTypes.func,
  onUpdateTitle: PropTypes.func,
  onUpdateDeadline: PropTypes.func,
  onClearDeadline: PropTypes.func,
  onRemove: PropTypes.func,
  onMarkDone: PropTypes.func,
  onToggleUrgent: PropTypes.func,
  onToggleImportant: PropTypes.func,
};


