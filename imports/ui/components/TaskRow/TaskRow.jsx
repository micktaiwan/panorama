import React from 'react';
import PropTypes from 'prop-types';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import { formatDate, formatDateTime, deadlineSeverity } from '/imports/ui/utils/date.js';
import './TaskRow.css';

export const TaskRow = ({
  as = 'li',
  task,
  // Project context (optional)
  projectName,
  projectColor,
  projectHref,
  showProject = false,
  allowProjectChange = false,
  projectOptions = [],
  onMoveProject,
  showMoveProjectButton = false,
  // Controls
  showStatusSelect = true,
  showDeadline = true,
  showClearDeadline = true,
  showDelete = true,
  showMarkDone = false,
  showUrgentImportant = false,
  editableDeadline = false,
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
  onToggleImportant
}) => {
  const Container = as || 'li';
  const [showMoveSelect, setShowMoveSelect] = React.useState(false);
  if (!task) return null;
  const status = task.status || 'todo';
  const sev = task.deadline ? deadlineSeverity(task.deadline) : '';
  const metaCls = sev ? ` ${sev}` : ' taskMetaDefault';

  return (
    <Container className={`taskRowC${status === 'in_progress' ? ' inProgress' : ''}${showProject ? ' withProject' : ''}${textSize === 'small' ? ' smallText' : ''}${inlineActions ? ' inlineActions' : ''}`}>
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
            const options = Array.isArray(projectOptions) ? projectOptions : [];
            return (
              <select
                className="taskProjectLink"
                value={task.projectId || ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  if (typeof onMoveProject === 'function') onMoveProject(val);
                }}
                title="Move to project"
              >
                <option value="">(no project)</option>
                {options.map((o) => (
                  <option key={o?.value || '__none__'} value={o?.value || ''}>{o?.label || ''}</option>
                ))}
              </select>
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
                { value: 'cancelled', label: 'cancelled' }
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
            onSubmit={(next) => { if (typeof onUpdateTitle === 'function') onUpdateTitle(String(next || '').trim()); }}
          />
          {task.notes ? (
            <div className="taskNotes" title={task.notes}>{task.notes}</div>
          ) : null}
          {inlineActions && showUrgentImportant ? (
            <span className="taskInlineActions">
              <button
                className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
                aria-pressed={!!task.isUrgent}
                title="Toggle urgent"
                onClick={() => onToggleUrgent && onToggleUrgent(task)}
              >urgent</button>
              <button
                className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
                aria-pressed={!!task.isImportant}
                title="Toggle important"
                onClick={() => onToggleImportant && onToggleImportant(task)}
              >important</button>
            </span>
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
                    if (typeof onMoveProject === 'function') onMoveProject(val);
                    setShowMoveSelect(false);
                  }}
                  title="Move to project"
                >
                  <option value="">(no project)</option>
                  {(Array.isArray(projectOptions) ? projectOptions : []).map((o) => {
                    const value = o && o.value ? o.value : '';
                    const label = o && o.label ? o.label : '';
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
        {showDeadline ? (
          editableDeadline ? (
            <div>
              {status === 'done' ? (
                <div className="doneMeta">Done {formatDate(task.statusChangedAt)}</div>
              ) : (
                <InlineDate
                  value={task.deadline}
                  onSubmit={(next) => { if (typeof onUpdateDeadline === 'function') onUpdateDeadline(next); }}
                  placeholder="No deadline"
                />
              )}
            </div>
          ) : (
            <div className={`taskMeta${metaCls}`}>
              {task.deadline ? `Due ${formatDate(task.deadline)}` : 'No deadline'} · {formatDateTime(task.createdAt)}
            </div>
          )
        ) : null}
        {showUrgentImportant ? (
          <span className="taskActions">
            <button
              className={`eisenhowerToggle${task.isUrgent ? ' active' : ''}`}
              aria-pressed={!!task.isUrgent}
              title="Toggle urgent"
              onClick={() => onToggleUrgent && onToggleUrgent(task)}
            >urgent</button>
            <button
              className={`eisenhowerToggle${task.isImportant ? ' active' : ''}`}
              aria-pressed={!!task.isImportant}
              title="Toggle important"
              onClick={() => onToggleImportant && onToggleImportant(task)}
            >important</button>
          </span>
        ) : null}
        {showClearDeadline && task.deadline ? (
          <button className="iconButton" title="Clear deadline" onClick={() => onClearDeadline && onClearDeadline()}>✕</button>
        ) : null}
        {showDelete ? (
          <button className="iconButton" title="Delete task" onClick={() => onRemove && onRemove()}>🗑</button>
        ) : null}
      </div>
      ) : null}
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
  // Typography
  textSize: PropTypes.oneOf(['normal', 'small']),
  // Layout
  inlineActions: PropTypes.bool,
  titleClassName: PropTypes.string,
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


