import React from 'react';
import PropTypes from 'prop-types';
import { InlineTaskRow } from './InlineTaskRow.jsx';

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
        let baseKey = `idx`;
        if (Array.isArray(t?.sourceLogIds) && t.sourceLogIds.length > 0) {
          baseKey = `src:${t.sourceLogIds.join(',')}`;
        } else if (t?.title) {
          baseKey = `title:${t.title}`;
        }
        const stableKey = `${baseKey}#${idx}`;
        return (
          <InlineTaskRow
            key={stableKey}
            task={t}
            index={idx}
            projects={projects}
            linkedLogIdSet={linkedLogIdSet}
            isLinkedSuggestion={isLinkedSuggestion}
            onUpdateDeadline={onUpdateDeadline}
            onUpdateProject={onUpdateProject}
            onCreateSingle={onCreateSingle}
            windowHours={windowHours}
          />
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


