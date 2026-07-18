import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import PropTypes from 'prop-types';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import { formatDate, formatDateTime, deadlineSeverity } from '/imports/ui/utils/date.js';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './TaskRow.css';

const EMPTY_ARRAY = [];

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
  showMarkDone = false,
  showUrgentImportant = false,
  editableDeadline = false,
  // Assignee (optional)
  showAssignee = false,
  memberOptions = EMPTY_ARRAY,
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
  onUpdateAssignee
}) => {
  const Container = as || 'li';
  const [showMoveSelect, setShowMoveSelect] = React.useState(false);
  // Notes modal state
  const [isNotesOpen, setIsNotesOpen] = React.useState(false);
  const [notesDraft, setNotesDraft] = React.useState('');
  // Resolve the assignee's display name (network users are published app-wide)
  const assigneeName = useTracker(() => {
    const id = task?.assigneeId;
    if (!id) return '';
    const u = Meteor.users.findOne(id, { fields: { username: 1, profile: 1, emails: 1 } });
    if (!u) return '';
    return u.username || u.profile?.name || u.emails?.[0]?.address || '';
  }, [task?.assigneeId]);
  if (!task) return null;
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

  return (
    <Container className={`taskRowC${status === 'in_progress' ? ' inProgress' : ''}${showProject ? ' withProject' : ''}${textSize === 'small' ? ' smallText' : ''}${inlineActions ? ' inlineActions' : ''}`} style={containerStyle}>
      <div className="taskLeft">
        {showMarkDone ? (
          <input
            type="checkbox"
            className="taskCheck"
            title="Mark as done"
            onChange={(e) => { if (e.target.checked && typeof onMarkDone === 'function') onMarkDone(task); }}
          />
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
          {Number.isFinite(task.priorityRank) ? (
            <span className="taskRankDebug" title={`Priority rank: ${task.priorityRank}`}>
              #{task.priorityRank}
            </span>
          ) : null}
          <span className="taskInlineActions">
            {inlineActions && showUrgentImportant ? (
              <>
                <button
                  className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
                  aria-pressed={!!task.isUrgent}
                  title="Toggle urgent"
                  onClick={() => onToggleUrgent?.(task)}
                >urgent</button>
                <button
                  className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
                  aria-pressed={!!task.isImportant}
                  title="Toggle important"
                  onClick={() => onToggleImportant?.(task)}
                >important</button>
              </>
            ) : null}
            <button className={`iconButton taskNotesButton${task.notes ? ' hasNotes' : ''}`} title={task.notes || 'Add notes'} aria-label="Notes" onClick={openNotes}>…</button>
          </span>
          {(() => {
            const canEdit = showAssignee && typeof onUpdateAssignee === 'function' && Array.isArray(memberOptions) && memberOptions.length > 0;
            if (canEdit) {
              const options = [{ value: '', label: '(no assignee)' }, ...memberOptions];
              return (
                <InlineEditable
                  as="select"
                  value={task.assigneeId || ''}
                  options={options}
                  className="taskAssignee"
                  inputClassName="taskAssignee"
                  onSubmit={(next) => { onUpdateAssignee(next || null); }}
                />
              );
            }
            if (assigneeName) {
              return (<span className="taskAssignee taskAssigneeReadonly" title={`Assignee: ${assigneeName}`}>{assigneeName}</span>);
            }
            return null;
          })()}
          {task.notes ? (
            <button
              type="button"
              className="taskNotes taskNotesClickable"
              title={task.notes}
              onClick={openNotes}
            >{task.notes}</button>
          ) : null}
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
                  title="Move to project"
                >
                  <option value="">(no project)</option>
                  {(Array.isArray(projectOptions) ? projectOptions : []).map((o) => {
                    const value = o?.value ? o.value : '';
                    const label = o?.label ? o.label : '';
                    return (<option key={value || '__none__'} value={value}>{label}</option>);
                  })}
                </select>
                <button className="iconButton" title="Cancel" onClick={() => setShowMoveSelect(false)}>✕</button>
              </>
            ) : (
              <button className="iconButton" title="Move to project" onClick={() => setShowMoveSelect(true)}>⇄</button>
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
            <button
              className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
              aria-pressed={!!task.isUrgent}
              title="Toggle urgent"
              onClick={() => onToggleUrgent?.(task)}
            >urgent</button>
            <button
              className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
              aria-pressed={!!task.isImportant}
              title="Toggle important"
              onClick={() => onToggleImportant?.(task)}
            >important</button>
          </span>
        ) : null}
        <button 
          className="iconButton" 
          title="Promote to top priority" 
          onClick={() => Meteor.call('tasks.promoteToTop', task._id)}
        >↑</button>
        {showClearDeadline && task.deadline ? (
          <button className="iconButton" title="Clear deadline" onClick={() => onClearDeadline?.()}>✕</button>
        ) : null}
        {showDelete ? (
          <button className="iconButton" title="Delete task" onClick={() => onRemove?.()}>🗑</button>
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
    projectId: PropTypes.string,
    assigneeId: PropTypes.string,
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
  showMarkDone: PropTypes.bool,
  showUrgentImportant: PropTypes.bool,
  editableDeadline: PropTypes.bool,
  // Assignee (optional)
  showAssignee: PropTypes.bool,
  memberOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onUpdateAssignee: PropTypes.func,
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


