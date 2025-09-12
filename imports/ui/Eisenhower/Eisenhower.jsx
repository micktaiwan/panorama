import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { TasksCollection } from '/imports/api/tasks/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import './Eisenhower.css';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import { TaskRow } from '/imports/ui/components/TaskRow/TaskRow.jsx';
import { deadlineSeverity } from '/imports/ui/utils/date.js';

export const Eisenhower = () => {
  useSubscribe('tasks');
  useSubscribe('projects');
  const tasks = useFind(() => TasksCollection.find({}, { fields: { isUrgent: 1, isImportant: 1, status: 1, title: 1, projectId: 1, deadline: 1, createdAt: 1 } }));
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1, isFavorite: 1, favoriteRank: 1 } }));
  const projectById = React.useMemo(() => {
    const acc = {};
    projects.forEach(p => { acc[p._id] = p.name || '(untitled project)'; });
    return acc;
  }, [projects]);

  const [projFilters, setProjFilters] = React.useState({});
  const openTasks = tasks.filter(t => !['done','cancelled'].includes(t.status || 'todo')).filter(t => {
    const pid = t.projectId || '';
    const state = projFilters[pid];
    if (state === -1) return false; // excluded
    const includeIds = Object.entries(projFilters).filter(([,v]) => v === 1).map(([k]) => k);
    if (includeIds.length > 0) return includeIds.includes(pid);
    return true;
  });

  // Sort open tasks: deadline asc (nulls last), in_progress first, createdAt asc
  const sortedOpenTasks = React.useMemo(() => {
    const toTime = (d) => d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
    return [...openTasks].sort((a, b) => {
      const ad = toTime(a.deadline); const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd;
      const as = statusRank(a.status || 'todo'); const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs;
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc;
    });
  }, [JSON.stringify(openTasks.map(t => [
    t._id,
    t.deadline ? new Date(t.deadline).toISOString().slice(0,10) : '',
    t.status || 'todo',
    t.createdAt ? new Date(t.createdAt).toISOString().slice(0,10) : '',
    t.isUrgent ? '1' : '0',
    t.isImportant ? '1' : '0',
    (t.title || '')
  ].join(':')))]);

  const titleSeverityClass = (deadline) => {
    if (!deadline) return '';
    const sev = deadlineSeverity(deadline);
    return sev || 'dueLater';
  };

  const toggleFlag = (t, key) => {
    Meteor.call('tasks.update', t._id, { [key]: !t[key] });
  };

  return (
    <div className="eisenhowerPage">
      <h2>Eisenhower Matrix</h2>
      <ProjectFilters projects={projects} storageKey="eisenhower_proj_filters" onChange={setProjFilters} />
      <div className="eisenhower">
        <div className="eisenhowerGrid">
          <div></div>
          <div className="eisenhowerHeader">Urgent</div>
          <div className="eisenhowerHeader">Not urgent</div>
          <div className="eisenhowerRowHeader">Important</div>
          <div className="eisenhowerQuadrant">
            <h4>Do</h4>
            <ul className="eisenhowerList scrollArea">
              {sortedOpenTasks.filter(t => !!t.isImportant && !!t.isUrgent).map(t => (
                <TaskRow
                  key={`iu-${t._id}`}
                  task={t}
                  textSize="small"
                  showProject={true}
                  projectName={projectById[t.projectId]}
                  projectHref={t.projectId ? `#/projects/${t.projectId}` : undefined}
                  projectColor={(projects.find(p => p._id === t.projectId)?.colorLabel) || '#6b7280'}
                  showStatusSelect={false}
                  showDeadline={false}
                  showClearDeadline={false}
                  showDelete={false}
                  showMarkDone
                  inlineActions
                  showUrgentImportant
                  titleClassName={titleSeverityClass(t.deadline)}
                  onUpdateTitle={(next) => Meteor.call('tasks.update', t._id, { title: next })}
                  onMarkDone={(task) => Meteor.call('tasks.update', task._id, { status: 'done' })}
                  onToggleUrgent={(task) => toggleFlag(task, 'isUrgent')}
                  onToggleImportant={(task) => toggleFlag(task, 'isImportant')}
                />
              ))}
            </ul>
          </div>
          <div className="eisenhowerQuadrant">
            <h4>Plan</h4>
            <ul className="eisenhowerList scrollArea">
              {sortedOpenTasks.filter(t => !!t.isImportant && !t.isUrgent).map(t => (
                <TaskRow
                  key={`in-${t._id}`}
                  task={t}
                  textSize="small"
                  showProject={true}
                  projectName={projectById[t.projectId]}
                  projectHref={t.projectId ? `#/projects/${t.projectId}` : undefined}
                  projectColor={(projects.find(p => p._id === t.projectId)?.colorLabel) || '#6b7280'}
                  showStatusSelect={false}
                  showDeadline={false}
                  showClearDeadline={false}
                  showDelete={false}
                  showMarkDone
                  inlineActions
                  showUrgentImportant
                  titleClassName={titleSeverityClass(t.deadline)}
                  onUpdateTitle={(next) => Meteor.call('tasks.update', t._id, { title: next })}
                  onMarkDone={(task) => Meteor.call('tasks.update', task._id, { status: 'done' })}
                  onToggleUrgent={(task) => toggleFlag(task, 'isUrgent')}
                  onToggleImportant={(task) => toggleFlag(task, 'isImportant')}
                />
              ))}
            </ul>
          </div>
          <div className="eisenhowerRowHeader">Not important</div>
          <div className="eisenhowerQuadrant">
            <h4>Delegate</h4>
            <ul className="eisenhowerList scrollArea">
              {sortedOpenTasks.filter(t => !t.isImportant && !!t.isUrgent).map(t => (
                <TaskRow
                  key={`nu-${t._id}`}
                  task={t}
                  textSize="small"
                  showProject={true}
                  projectName={projectById[t.projectId]}
                  projectHref={t.projectId ? `#/projects/${t.projectId}` : undefined}
                  projectColor={(projects.find(p => p._id === t.projectId)?.colorLabel) || '#6b7280'}
                  showStatusSelect={false}
                  showDeadline={false}
                  showClearDeadline={false}
                  showDelete={false}
                  showMarkDone
                  inlineActions
                  showUrgentImportant
                  titleClassName={titleSeverityClass(t.deadline)}
                  onUpdateTitle={(next) => Meteor.call('tasks.update', t._id, { title: next })}
                  onMarkDone={(task) => Meteor.call('tasks.update', task._id, { status: 'done' })}
                  onToggleUrgent={(task) => toggleFlag(task, 'isUrgent')}
                  onToggleImportant={(task) => toggleFlag(task, 'isImportant')}
                />
              ))}
            </ul>
          </div>
          <div className="eisenhowerQuadrant">
            <h4>Eliminate</h4>
            <ul className="eisenhowerList scrollArea">
              {sortedOpenTasks.filter(t => !t.isImportant && !t.isUrgent).map(t => (
                <TaskRow
                  key={`nn-${t._id}`}
                  task={t}
                  textSize="small"
                  showProject={true}
                  projectName={projectById[t.projectId]}
                  projectHref={t.projectId ? `#/projects/${t.projectId}` : undefined}
                  projectColor={(projects.find(p => p._id === t.projectId)?.colorLabel) || '#6b7280'}
                  showStatusSelect={false}
                  showDeadline={false}
                  showClearDeadline={false}
                  showDelete={false}
                  showMarkDone
                  inlineActions
                  showUrgentImportant
                  titleClassName={titleSeverityClass(t.deadline)}
                  onUpdateTitle={(next) => Meteor.call('tasks.update', t._id, { title: next })}
                  onMarkDone={(task) => Meteor.call('tasks.update', task._id, { status: 'done' })}
                  onToggleUrgent={(task) => toggleFlag(task, 'isUrgent')}
                  onToggleImportant={(task) => toggleFlag(task, 'isImportant')}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};


