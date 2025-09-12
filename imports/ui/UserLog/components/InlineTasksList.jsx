import React from 'react';
import PropTypes from 'prop-types';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';

export function InlineTasksList({
  tasks,
  projects,
  linkedLogIdSet,
  isLinkedSuggestion,
  hiddenTasksCount,
  hideExisting,
  onUpdateDeadline,
  onUpdateProject,
  onCreateSingle,
  windowHours,
}) {
  const hasItems = Array.isArray(tasks) && tasks.length > 0;
  if (!hasItems) {
    const allHidden = hideExisting && hiddenTasksCount > 0;
    const message = allHidden
      ? `All suggestions hidden (${hiddenTasksCount})`
      : 'No suggested tasks.';
    return <div className="UserLog__empty">{message}</div>;
  }

  return (
    <ul className="UserLog__inlineTasksList scrollArea">
      {tasks.map((t, idx) => {
        let stableKey = `idx:${idx}`;
        if (Array.isArray(t?.sourceLogIds) && t.sourceLogIds.length > 0) {
          stableKey = `src:${t.sourceLogIds.join(',')}`;
        } else if (t?.title) {
          stableKey = `title:${t.title}`;
        }
        const hasDbLinked = isLinkedSuggestion ? isLinkedSuggestion(t) : (Array.isArray(t?.sourceLogIds) && t.sourceLogIds.some(id => linkedLogIdSet.has(String(id))));
        return (
          <li key={stableKey} className={`UserLog__inlineTaskRow${hasDbLinked ? ' isLinked' : ''}`}>
            <div className="UserLog__inlineTaskMain">
              <div className="UserLog__inlineTaskTitle">{t.title}</div>
              {t.notes ? <div className="UserLog__inlineTaskNotes">{t.notes}</div> : null}
              {hasDbLinked ? null : (
                <>
                  <div className="UserLog__inlineTaskDeadline">
                    <label htmlFor={`ul_task_deadline_${idx}`}>Deadline:&nbsp;</label>
                    <InlineDate
                      id={`ul_task_deadline_${idx}`}
                      value={t.deadline || ''}
                      onSubmit={(next) => onUpdateDeadline(t, next)}
                      placeholder="No deadline"
                    />
                  </div>
                  <div className="UserLog__inlineTaskProject">
                    <label htmlFor={`ul_task_project_${idx}`}>Project:&nbsp;</label>
                    <select
                      className="UserLog__inlineTaskProjectSelect"
                      id={`ul_task_project_${idx}`}
                      value={t.projectId || ''}
                      onChange={(e) => onUpdateProject(t, e.target.value)}
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
                onClick={() => onCreateSingle(t, windowHours)}
              >Create task</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

InlineTasksList.propTypes = {
  tasks: PropTypes.array.isRequired,
  projects: PropTypes.array.isRequired,
  linkedLogIdSet: PropTypes.object.isRequired,
  isLinkedSuggestion: PropTypes.func,
  hiddenTasksCount: PropTypes.number.isRequired,
  hideExisting: PropTypes.bool.isRequired,
  onUpdateDeadline: PropTypes.func.isRequired,
  onUpdateProject: PropTypes.func.isRequired,
  onCreateSingle: PropTypes.func.isRequired,
  windowHours: PropTypes.number.isRequired,
};


