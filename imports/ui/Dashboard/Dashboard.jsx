import React, { useMemo, useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { TasksCollection } from '/imports/api/tasks/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import './Dashboard.css';
import { formatDateTime, deadlineSeverity } from '/imports/ui/utils/date.js';
import { ProjectsOverview } from '/imports/ui/Dashboard/ProjectsOverview.jsx';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import { TaskRow } from '/imports/ui/components/TaskRow/TaskRow.jsx';

export const Dashboard = () => {
  
  useSubscribe('tasks');
  useSubscribe('projects');
  useSubscribe('noteSessions');
  const rawTasks = useFind(() => TasksCollection.find({ $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ] }, { sort: { createdAt: 1 } }));
  const allTasks = useFind(() => TasksCollection.find({}, { fields: { status: 1, deadline: 1, createdAt: 1, statusChangedAt: 1, title: 1, projectId: 1 } }));
  // flags are not needed on this screen beyond status/deadline metrics
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1, colorLabel: 1, isFavorite: 1, favoriteRank: 1 } }));
  const projectsForFilter = projects; // ordering handled in ProjectFilters
  const standaloneSessions = useFind(() => NoteSessionsCollection.find({ $or: [ { projectId: { $exists: false } }, { projectId: null }, { projectId: '' } ] }, { sort: { createdAt: -1 } }));
  const projectById = useMemo(() => {
    const acc = {};
    projects.forEach(p => { acc[p._id] = p.name || '(untitled project)'; });
    return acc;
  }, [projects]);

  const tasks = useMemo(() => {
    const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1); // in_progress before other statuses
    return [...rawTasks].sort((a, b) => {
      const ad = toTime(a.deadline);
      const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd; // earlier deadlines first; nulls go last (Infinity)
      const as = statusRank(a.status || 'todo');
      const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs; // in_progress before other statuses
      const ac = new Date(a.createdAt).getTime();
      const bc = new Date(b.createdAt).getTime();
      return ac - bc; // earlier created first
    });
  }, [rawTasks]);

  const stats = useMemo(() => {
    const total = allTasks.length;
    const open = allTasks.filter(t => !['done','cancelled'].includes(t.status || 'todo')).length;
    const closed = total - open;
    const withDeadline = allTasks.filter(t => !['done','cancelled'].includes(t.status || 'todo') && !!t.deadline).length;
    // Overdue counts only open tasks due today or earlier
    const overdue = allTasks.filter(t => !['done','cancelled'].includes(t.status || 'todo') && t.deadline && deadlineSeverity(t.deadline) === 'dueNow').length;
    return { total, open, closed, withDeadline, overdue };
  }, [JSON.stringify(allTasks.map(t => [(t.status || 'todo') !== 'done' ? 'o' : 'c', t.deadline ? new Date(t.deadline).toDateString() : ''].join(':')))]);

  const recentDone = useMemo(() => {
    const done = allTasks.filter(t => ['done','cancelled'].includes(t.status || 'todo') && t.statusChangedAt);
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(todayStart.getDate() + 1);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
    const today = done
      .filter(t => new Date(t.statusChangedAt) >= todayStart && new Date(t.statusChangedAt) < tomorrowStart)
      .sort((a, b) => new Date(b.statusChangedAt) - new Date(a.statusChangedAt));
    const yesterday = done
      .filter(t => new Date(t.statusChangedAt) >= yesterdayStart && new Date(t.statusChangedAt) < todayStart)
      .sort((a, b) => new Date(b.statusChangedAt) - new Date(a.statusChangedAt));
    return { today, yesterday };
  }, [JSON.stringify(allTasks.map(t => [(t.status || 'todo'), t.statusChangedAt ? new Date(t.statusChangedAt).toISOString().slice(0,10) : ''].join(':')))]);

  // Project filters (tri-state per project: include -> 1, exclude -> -1, neutral -> 0/undefined)
  const [projFilters, setProjFilters] = useState({});
  const filteredTasks = useMemo(() => {
    const includeIds = new Set(Object.entries(projFilters).filter(([,v]) => v === 1).map(([k]) => k));
    const excludeIds = new Set(Object.entries(projFilters).filter(([,v]) => v === -1).map(([k]) => k));
    return tasks.filter(t => {
      const pid = t.projectId || '';
      if (excludeIds.has(pid)) return false;
      if (includeIds.size > 0) return includeIds.has(pid);
      return true;
    });
  }, [tasks, JSON.stringify(projFilters)]);

  const removeTask = (taskId) => {
    if (!taskId) return;
    Meteor.call('tasks.remove', taskId, (err) => {
      if (err) {
        // Simple UI feedback; dashboard has no local error banner
        alert(err.reason || err.message || 'Failed to delete task');
      }
    });
  };

  // no toggleFlag on dashboard; use inline controls in TaskRow

  // Avoid loading flicker on route changes; render with reactive data

  const [showRecent, setShowRecent] = useState(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('dashboard_recent_done_open') : null;
    if (v === '0') return false;
    if (v === '1') return true;
    return true;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dashboard_recent_done_open', showRecent ? '1' : '0');
    }
  }, [showRecent]);

  return (
    <div className="dashboard">
      <div className="dashboardHeader">
        <h2>Dashboard</h2>
      </div>
      
      <ProjectsOverview />
      <h2>Tasks</h2>
      <div className="tasksStats">
        <span><span className="statLabel">Total</span> <span className="statValue">{stats.total}</span></span>
        <span className="dot">·</span>
        <span><span className="statLabel">Open</span> <span className="statValue">{stats.open}</span></span>
        <span className="dot">·</span>
        <span><span className="statLabel">Closed</span> <span className="statValue">{stats.closed}</span></span>
        <span className="dot">·</span>
        <span><span className="statLabel">With deadline</span> <span className="statValue">{stats.withDeadline}</span></span>
        <span className="dot">·</span>
        <span><span className="statLabel">Overdue (incl. today)</span> <span className="statValue dueNow">{stats.overdue}</span></span>
        {!showRecent ? (
          <button className="reopenLink" onClick={() => setShowRecent(true)}>Recently done</button>
        ) : null}
      </div>
      {showRecent && (recentDone.today.length > 0 || recentDone.yesterday.length > 0) && (
        <div className="recentDone">
          <div className="recentDoneHeader">
            <h3>Recently done</h3>
            <button className="closeBtn" onClick={() => setShowRecent(false)}>×</button>
          </div>
          {recentDone.today.length > 0 && (
            <div className="recentGroup">
              <div className="recentLabel">Today</div>
              <ul className="taskList">
                {recentDone.today.map(t => (
                  <li key={`t-${t._id}`} className="taskItem">
                    <div className="taskTitle">
                      <span className="taskProjectCol">
                        {t.projectId ? (
                          <a href={`#/projects/${t.projectId}`} className="taskProjectLink">{projectById[t.projectId] || 'Open project'}</a>
                        ) : <span className="taskProjectLink">—</span>}
                      </span>
                      {t.title || '(untitled task)'}
                    </div>
                    <div className="taskRight">
                      <div className="taskMeta taskMetaDefault">{formatDateTime(t.statusChangedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recentDone.yesterday.length > 0 && (
            <div className="recentGroup">
              <div className="recentLabel">Yesterday</div>
              <ul className="taskList">
                {recentDone.yesterday.map(t => (
                  <li key={`y-${t._id}`} className="taskItem">
                    <div className="taskTitle">
                      <span className="taskProjectCol">
                        {t.projectId ? (
                          <a href={`#/projects/${t.projectId}`} className="taskProjectLink">{projectById[t.projectId] || 'Open project'}</a>
                        ) : <span className="taskProjectLink">—</span>}
                      </span>
                      {t.title || '(untitled task)'}
                    </div>
                    <div className="taskRight">
                      <div className="taskMeta taskMetaDefault">{formatDateTime(t.statusChangedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {/* Project filter chips (tri-state) */}
      <ProjectFilters projects={projectsForFilter} storageKey="dashboard_proj_filters" onChange={setProjFilters} />
      <div className="tasksScroll scrollArea">
      <ul className="taskList">
        {filteredTasks.map(t => (
          <TaskRow
            key={t._id}
            task={t}
            showProject={true}
            projectName={t.projectId ? (projectById[t.projectId] || 'Open project') : '—'}
            projectHref={t.projectId ? `#/projects/${t.projectId}` : undefined}
            projectColor={(projects.find(p => p._id === t.projectId)?.colorLabel) || '#6b7280'}
            showStatusSelect
            showDeadline
            showClearDeadline
            showDelete
            onUpdateStatus={(next) => Meteor.call('tasks.update', t._id, { status: next })}
            onUpdateTitle={(title) => Meteor.call('tasks.update', t._id, { title })}
            onClearDeadline={() => Meteor.call('tasks.update', t._id, { deadline: null })}
            onRemove={() => removeTask(t._id)}
          />
        ))}
      </ul>
      </div>
      {standaloneSessions.length > 0 && (
        <div className="standaloneSessions">
          <h2>Standalone Note Sessions ({standaloneSessions.length})</h2>
          <ul className="sessionList">
            {standaloneSessions.map(s => (
              <li key={s._id} className="sessionItem">
                <a
                  href={`#/sessions/${s._id}`}
                  className="sessionTitle"
                  title={s.name?.trim() ? s.name : '(untitled session)'}
                >
                  {s.name?.trim() ? s.name : '(untitled session)'}
                </a>
                <span className="sessionMeta"> · {formatDateTime(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};


