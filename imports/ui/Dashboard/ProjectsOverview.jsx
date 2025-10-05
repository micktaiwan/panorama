import React, { useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { timeAgo } from '/imports/ui/utils/date.js';

const withinDays = (date, n) => {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const diff = d.getTime() - Date.now();
  return diff <= n * 24 * 60 * 60 * 1000;
};

export const ProjectsOverview = () => {
  const subP = useSubscribe('projects');
  const subT = useSubscribe('tasks');
  const projectsRaw = useFind(() => ProjectsCollection.find({}, { sort: { updatedAt: -1 } }));
  
  const projects = useMemo(() => {
    return [...projectsRaw].sort((a, b) => {
      const aHas = !!a.targetDate;
      const bHas = !!b.targetDate;
      if (aHas !== bHas) return bHas - aHas; // items with targetDate first
      const at = a.targetDate ? new Date(a.targetDate).getTime() : 0;
      const bt = b.targetDate ? new Date(b.targetDate).getTime() : 0;
      if (at !== bt) return at - bt; // ASC by targetDate
      const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bu - au; // fallback to recent update
    });
  }, [projectsRaw]);
  const tasks = useFind(() => TasksCollection.find({ $or: [ { status: { $exists: false } }, { status: { $ne: 'done' } } ] }));

  const byProjectOpenTasks = useMemo(() => {
    const acc = {};
    tasks.forEach(t => {
      if (!t.projectId) return;
      acc[t.projectId] = (acc[t.projectId] || 0) + 1;
    });
    return acc;
  }, [tasks]);

  const signals = useMemo(() => {
    const now = Date.now();
    const staleThreshold = 14 * 24 * 60 * 60 * 1000;
    let active = 0, blocked = 0, dueSoon = 0, stale = 0;
    projects.forEach(p => {
      if ((p.status || '').toLowerCase() === 'blocked') blocked += 1;
      if ((p.status || '').toLowerCase() === 'active') active += 1;
      if (p.targetDate && withinDays(p.targetDate, 7)) dueSoon += 1;
      const lu = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
      if (lu > 0 && now - lu > staleThreshold) stale += 1;
    });
    return { active, blocked, dueSoon, stale };
  }, [projects]);

  if (subP() || subT()) return <div>Loading...</div>;

  return (
    <div className="projectsOverview">
      <div className="signalsStrip">
        <div className="signalBox"><div className="signalLabel">Active</div><div className="signalValue">{signals.active}</div></div>
        <div className="signalBox"><div className="signalLabel">Blocked</div><div className="signalValue">{signals.blocked}</div></div>
        <div className="signalBox"><div className="signalLabel">Due ≤7d</div><div className="signalValue">{signals.dueSoon}</div></div>
        <div className="signalBox"><div className="signalLabel">Stale</div><div className="signalValue">{signals.stale}</div></div>
      </div>
      <div className="projectsScroll scrollArea">
      <table className="projectsTable">
        <thead>
          <tr>
            <th>Project</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Target</th>
            <th>Risk</th>
            <th className="alignCenter">Open tasks</th>
            <th className="alignRight">Last update</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => {
            const status = (p.status || 'n/a').toLowerCase();
            const sev = p.targetDate ? (withinDays(p.targetDate, 0) ? 'dueNow' : withinDays(p.targetDate, 7) ? 'dueSoon' : '') : '';
            const lastUpd = p.updatedAt ? timeAgo(p.updatedAt) : '—';
            const open = byProjectOpenTasks[p._id] || 0;
            const color = (typeof p.colorLabel === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.colorLabel)) ? p.colorLabel : '#6b7280';
            return (
              <tr key={p._id}>
                <td className="projName">
                  <button
                    className={`starBtn${p.isFavorite ? ' active' : ''}`}
                    title={p.isFavorite ? 'Unfavorite project' : 'Mark as favorite'}
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
                  <a href={`#/projects/${p._id}`}>
                    <svg className="projFlag" viewBox="0 0 16 16" aria-hidden="true">
                      <path fill={color} d="M2 2v12h2V9h5l1 1h4V3h-3l-1-1H4V2H2z" />
                    </svg>
                    {p.name || '(untitled project)'}
                  </a>
                </td>
                <td><span className={`statusBadge ${status}`}>{p.status || 'n/a'}</span></td>
                <td className="alignRight">{typeof p.progressPercent === 'number' ? `${p.progressPercent}%` : '—'}</td>
                <td className={sev} title={p.targetDate ? new Date(p.targetDate).toLocaleString() : ''}>
                  {p.targetDate ? (
                    <>
                      {new Date(p.targetDate).toLocaleDateString()}
                      <span className="muted"> · {timeAgo(p.targetDate)}</span>
                    </>
                  ) : '—'}
                </td>
                <td>
                  {p.riskLevel ? (
                    <span className={`riskBadge ${String(p.riskLevel).toLowerCase()}`}>{p.riskLevel}</span>
                  ) : '—'}
                </td>
                <td className="alignCenter">{open}</td>
                <td className="alignRight" title={p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ''}>{lastUpd}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
};


