import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { TasksCollection, TRASH_RETENTION_DAYS } from '/imports/api/tasks/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { navigateTo } from '/imports/ui/router.js';
import { formatCompactDateTime, timeAgo, timeUntilPrecise, formatDate } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import './TrashPage.css';

const purgeDate = (deletedAt) => new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

export const TrashPage = () => {
  const sub = useSubscribe('tasks.trashed');
  const subProjects = useSubscribe('projects');
  const tasks = useFind(() => TasksCollection.find({ deletedAt: { $exists: true } }, { sort: { deletedAt: -1 } }));
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1 } }));
  const projectNameById = React.useMemo(() => {
    const map = {};
    projects.forEach(p => { map[p._id] = p.name || '(untitled project)'; });
    return map;
  }, [projects]);

  const restore = (task) => {
    Meteor.call('tasks.restore', task._id, (err) => {
      if (err) {
        notify({ message: err.reason || err.message || 'Failed to restore task', kind: 'error' });
        return;
      }
      notify({ message: `Restored “${task.title || '(untitled task)'}”`, kind: 'success' });
    });
  };

  if (sub() || subProjects()) return <div>Loading…</div>;

  return (
    <div>
      <h2>Trash</h2>
      <p className="trashIntro">
        Deleted tasks stay here for {TRASH_RETENTION_DAYS} days, then a cron removes them for good.
      </p>
      <Card>
        {tasks.length === 0 ? (
          <div>Trash is empty.</div>
        ) : (
          <table className="trashTable">
            <thead>
              <tr>
                <th className="colTitle">Task</th>
                <th className="colProject">Project</th>
                <th className="colStatus">Status</th>
                <th className="colDeleted">Deleted</th>
                <th className="colPurge">Purged</th>
                <th className="colRight">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t._id}>
                  <td className="colTitle">
                    <Tooltip content={t.title || '(untitled task)'} className="tooltipTriggerBlock">
                      {t.title || '(untitled task)'}
                    </Tooltip>
                    {t.deadline ? <span className="trashDeadline"> — was due {formatDate(t.deadline)}</span> : null}
                  </td>
                  <td className="colProject">
                    {t.projectId ? (
                      <a
                        href={`#/projects/${t.projectId}`}
                        onClick={(e) => { e.preventDefault(); navigateTo({ name: 'project', projectId: t.projectId }); }}
                      >
                        {projectNameById[t.projectId] || '(untitled project)'}
                      </a>
                    ) : (
                      <span className="trashMuted">(no project)</span>
                    )}
                  </td>
                  <td className="colStatus">{t.status || 'todo'}</td>
                  <td className="colDeleted">
                    <Tooltip content={formatCompactDateTime(t.deletedAt)}>{timeAgo(t.deletedAt)}</Tooltip>
                  </td>
                  <td className="colPurge">
                    <span className="trashPurge">{timeUntilPrecise(purgeDate(t.deletedAt))}</span>
                  </td>
                  <td className="colRight">
                    <button className="btn" onClick={() => restore(t)}>Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
