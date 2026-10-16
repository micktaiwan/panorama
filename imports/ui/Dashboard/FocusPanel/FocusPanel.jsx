import React, { useMemo } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { computeFocusState } from '/imports/api/_shared/focus';
import { timeAgo, deadlineSeverity } from '/imports/ui/utils/date.js';
import { useNow } from '/imports/ui/hooks/useNow.js';
import './FocusPanel.css';

// The user's (max 3) workstreams, each reduced to one line: its next action.
// The focus list is set from Claude through the MCP tool tool_focusSet.
export const FocusPanel = () => {
  useSubscribe('userPreferences');
  useSubscribe('projects');
  useSubscribe('tasks');
  const prefs = useFind(() => UserPreferencesCollection.find({}, { limit: 1, fields: { focus: 1 } }))[0];
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1, colorLabel: 1 } }));
  const tasks = useFind(() => TasksCollection.find({ deletedAt: { $exists: false } }));
  const now = useNow();

  const focus = useMemo(() => (Array.isArray(prefs?.focus) ? prefs.focus : []), [prefs?.focus]);
  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p._id, p])), [projects]);
  const items = useMemo(
    () => focus.map(f => ({ ...f, state: computeFocusState(f, tasks, now) })),
    [focus, tasks, now]
  );

  if (focus.length === 0) {
    return (
      <section className="focusPanel">
        <h2>Focus</h2>
        <p className="focusEmpty">No focus set. Ask Claude to set your 3 workstreams.</p>
      </section>
    );
  }

  return (
    <section className="focusPanel">
      <h2>Focus</h2>
      <div className="focusGrid">
        {items.map((f, i) => {
          const next = f.state.nextAction;
          const nextProject = next?.projectId ? projectById[next.projectId] : null;
          return (
            <article key={`${i}-${f.title}`} className="focusCard">
              <div className="focusCardHeader">
                <span className="focusIndex">{i + 1}</span>
                <h3 className="focusTitle">{f.title}</h3>
              </div>
              <div className="focusNext">
                {next ? (
                  nextProject ? (
                    <a className="focusNextTitle" href={`#/projects/${nextProject._id}`}>{next.title || '(untitled task)'}</a>
                  ) : (
                    <span className="focusNextTitle">{next.title || '(untitled task)'}</span>
                  )
                ) : (
                  <span className="focusNextNone">No next action</span>
                )}
                {next && (next.status === 'in_progress' || next.deadline) && (
                  <div className="focusNextMeta">
                    {next.status === 'in_progress' && <span className="focusInProgress">In progress</span>}
                    {next.deadline && (
                      <span className={`focusDeadline ${deadlineSeverity(next.deadline)}`}>
                        Due {new Date(next.deadline).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="focusMeta">
                {f.state.overdueCount > 0 && (
                  <span className="focusOverdue">{f.state.overdueCount} overdue</span>
                )}
                <span>{f.state.openCount} open</span>
                {f.state.lastActivityAt && <span>active {timeAgo(f.state.lastActivityAt)}</span>}
              </div>
              {(f.projectIds || []).length > 0 && (
                <div className="focusProjects">
                  {f.projectIds.map(pid => (
                    <a key={pid} className="focusProject" href={`#/projects/${pid}`}>
                      {projectById[pid]?.name || '(unknown project)'}
                    </a>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
