import React, { useMemo, useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { CLOSED_TASK_STATUSES } from '/imports/api/_shared/taskStatus';
import { timeAgo, isSnoozed, deadlineSeverity } from '/imports/ui/utils/date.js';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { useNow } from '/imports/ui/hooks/useNow.js';

const COLLAPSED_ROWS = 10;
const HEALTH_RANK = { red: 0, orange: 1, green: 2 };
const HEALTH_LABEL = { red: 'Red', orange: 'Orange', green: 'Green' };

const readStored = (key) => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);
const writeStored = (key, value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
};

// Projects that need attention first: overdue work, then red/orange health,
// then the most recently active. Only fields that are actually filled are
// shown (target dates and risk levels are never set in practice).
export const ProjectsOverview = () => {
  const subP = useSubscribe('projects');
  const subT = useSubscribe('tasks');
  const projectsRaw = useFind(() => ProjectsCollection.find({}));
  const tasks = useFind(() => TasksCollection.find(
    { deletedAt: { $exists: false } },
    { fields: { projectId: 1, status: 1, deadline: 1, snoozedUntil: 1, updatedAt: 1, createdAt: 1 } }
  ));
  const now = useNow();

  const [filter, setFilter] = useState(() => readStored('dashboard_projects_filter') || '');
  const [showAll, setShowAll] = useState(() => readStored('dashboard_projects_show_all') === '1');
  useEffect(() => { writeStored('dashboard_projects_filter', filter); }, [filter]);
  useEffect(() => { writeStored('dashboard_projects_show_all', showAll ? '1' : '0'); }, [showAll]);

  const statsByProject = useMemo(() => {
    const acc = {};
    tasks.forEach(t => {
      if (!t.projectId) return;
      const s = acc[t.projectId] || (acc[t.projectId] = { open: 0, overdue: 0, lastActivity: 0 });
      const touched = new Date(t.updatedAt || t.createdAt || 0).getTime();
      if (touched > s.lastActivity) s.lastActivity = touched;
      if (CLOSED_TASK_STATUSES.includes(t.status || 'todo') || isSnoozed(t, now)) return;
      s.open += 1;
      if (t.deadline && deadlineSeverity(t.deadline) === 'dueNow') s.overdue += 1;
    });
    return acc;
  }, [tasks, now]);

  const rows = useMemo(() => projectsRaw.map(p => {
    const s = statsByProject[p._id] || { open: 0, overdue: 0, lastActivity: 0 };
    const projectTouched = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
    return {
      project: p,
      health: HEALTH_RANK[p.panoramaStatus] !== undefined ? p.panoramaStatus : '',
      open: s.open,
      overdue: s.overdue,
      lastActivity: Math.max(s.lastActivity, projectTouched),
    };
  }).sort((a, b) => {
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    const ah = a.health ? HEALTH_RANK[a.health] : 3;
    const bh = b.health ? HEALTH_RANK[b.health] : 3;
    if (ah !== bh) return ah - bh;
    return b.lastActivity - a.lastActivity;
  }), [projectsRaw, statsByProject]);

  const attention = useMemo(() => ({
    overdueTasks: rows.reduce((n, r) => n + r.overdue, 0),
    overdueProjects: rows.filter(r => r.overdue > 0).length,
    red: rows.filter(r => r.health === 'red').length,
    orange: rows.filter(r => r.health === 'orange').length,
  }), [rows]);

  const filtered = useMemo(() => {
    if (filter === 'overdue') return rows.filter(r => r.overdue > 0);
    if (filter === 'red' || filter === 'orange') return rows.filter(r => r.health === filter);
    return rows;
  }, [rows, filter]);
  const visible = showAll || filter ? filtered : filtered.slice(0, COLLAPSED_ROWS);

  if (subP() || subT()) return <div className="projectsOverview muted">Loading…</div>;

  const toggleFilter = (key) => setFilter(prev => (prev === key ? '' : key));
  const chip = (key, label, tone) => (
    <button
      type="button"
      className={`attentionChip ${tone}${filter === key ? ' active' : ''}`}
      onClick={() => toggleFilter(key)}
      aria-pressed={filter === key}
    >{label}</button>
  );

  return (
    <section className="projectsOverview">
      <div className="projectsHeader">
        <h2>Projects</h2>
        <div className="attentionLine">
          {attention.overdueTasks > 0 && chip('overdue', `${attention.overdueTasks} overdue in ${attention.overdueProjects} project${attention.overdueProjects !== 1 ? 's' : ''}`, 'danger')}
          {attention.red > 0 && chip('red', `${attention.red} red`, 'danger')}
          {attention.orange > 0 && chip('orange', `${attention.orange} orange`, 'warning')}
          {filter && (
            <button type="button" className="attentionClear" onClick={() => setFilter('')}>Clear filter</button>
          )}
        </div>
      </div>
      <table className="projectsTable">
        <thead>
          <tr>
            <th>Project</th>
            <th className="alignCenter">Health</th>
            <th className="alignRight">Overdue</th>
            <th className="alignRight">Open</th>
            <th className="alignRight">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ project: p, health, open, overdue, lastActivity }) => {
            const color = (typeof p.colorLabel === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorLabel)) ? p.colorLabel : '#6b7280';
            return (
              <tr key={p._id}>
                <td className="projName">
                  <Tooltip content={p.isFavorite ? 'Unfavorite project' : 'Mark as favorite'}>
                    <button
                      className={`starBtn${p.isFavorite ? ' active' : ''}`}
                      aria-label={p.isFavorite ? 'Unfavorite project' : 'Mark as favorite'}
                      onClick={(e) => {
                        e.preventDefault();
                        const next = !p.isFavorite;
                        const modifier = next && (typeof p.favoriteRank === 'undefined' || p.favoriteRank === null)
                          ? { isFavorite: true, favoriteRank: Date.now() }
                          : { isFavorite: next };
                        Meteor.call('projects.update', p._id, modifier);
                      }}
                    >
                      <svg className="starIcon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                      </svg>
                    </button>
                  </Tooltip>
                  <a href={`#/projects/${p._id}`}>
                    <svg className="projFlag" viewBox="0 0 16 16" aria-hidden="true">
                      <path fill={color} d="M2 2v12h2V9h5l1 1h4V3h-3l-1-1H4V2H2z" />
                    </svg>
                    {p.name || '(untitled project)'}
                  </a>
                </td>
                <td className="alignCenter">
                  {health ? (
                    <Tooltip content={HEALTH_LABEL[health]}>
                      <span className={`healthDot ${health}`} aria-label={HEALTH_LABEL[health]} />
                    </Tooltip>
                  ) : null}
                </td>
                <td className={`alignRight${overdue > 0 ? ' overdueCell' : ''}`}>{overdue > 0 ? overdue : ''}</td>
                <td className="alignRight mutedCell">{open > 0 ? open : ''}</td>
                <td className="alignRight mutedCell">
                  {lastActivity > 0 ? (
                    <Tooltip content={new Date(lastActivity).toLocaleString()}>{timeAgo(new Date(lastActivity))}</Tooltip>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!filter && filtered.length > COLLAPSED_ROWS && (
        <button type="button" className="showAllBtn" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show less' : `Show all ${filtered.length} projects`}
        </button>
      )}
    </section>
  );
};
