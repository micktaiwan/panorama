import React from 'react';
import PropTypes from 'prop-types';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import './InlineTaskRow.css';

export function InlineTaskRow({
  task,
  index,
  projects,
  linkedLogIdSet,
  isLinkedSuggestion,
  onUpdateDeadline,
  onUpdateProject,
  onCreateSingle,
  windowHours,
}) {
  const hasDbLinked = isLinkedSuggestion
    ? isLinkedSuggestion(task)
    : (Array.isArray(task?.sourceLogIds) && task.sourceLogIds.some(id => linkedLogIdSet.has(String(id))));

  return (
    <li className={`UserLog__inlineTaskRow${hasDbLinked ? ' isLinked' : ''}`}>
      <div className="UserLog__inlineTaskMain">
        <div className="UserLog__inlineTaskTitle">{task.title}</div>
        {task.notes ? <div className="UserLog__inlineTaskNotes">{task.notes}</div> : null}
        {hasDbLinked ? null : (
          <>
            <div className="UserLog__inlineTaskDeadline">
              <label htmlFor={`ul_task_deadline_${index}`}>Deadline:&nbsp;</label>
              <InlineDate
                id={`ul_task_deadline_${index}`}
                value={task.deadline || ''}
                onSubmit={(next) => onUpdateDeadline(task, next)}
                placeholder="No deadline"
              />
            </div>
            <div className="UserLog__inlineTaskProject">
              <label htmlFor={`ul_task_project_${index}`}>Project:&nbsp;</label>
              <select
                className="UserLog__inlineTaskProjectSelect"
                id={`ul_task_project_${index}`}
                value={task.projectId || ''}
                onChange={(e) => onUpdateProject(task, e.target.value)}
              >
                <option value="">(none)</option>
                {(projects || []).map(p => (
                  <option key={p._id} value={p._id}>{p.name || '(untitled)'}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {hasDbLinked ? null : (
        <button
          className="btn btn-xs"
          onClick={() => onCreateSingle(task, windowHours)}
        >Create task</button>
      )}
    </li>
  );
}

InlineTaskRow.propTypes = {
  task: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  projects: PropTypes.array.isRequired,
  linkedLogIdSet: PropTypes.object.isRequired,
  isLinkedSuggestion: PropTypes.func,
  onUpdateDeadline: PropTypes.func.isRequired,
  onUpdateProject: PropTypes.func.isRequired,
  onCreateSingle: PropTypes.func.isRequired,
  windowHours: PropTypes.number.isRequired,
};


