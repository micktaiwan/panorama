import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { FilesCollection } from '../../api/files/collections';
import { ProjectsCollection } from '../../api/projects/collections';
import { Card } from '../components/Card/Card.jsx';
import { FileItem } from '../components/File/File.jsx';
import './FilesPage.css';
import { navigateTo } from '../router.js';

export const FilesPage = () => {
  const sub = useSubscribe('files');
  const subProjects = useSubscribe('projects');
  const files = useFind(() => FilesCollection.find({}, { sort: { createdAt: -1 } }));
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1 } }));
  const projectNameById = React.useMemo(() => {
    const map = {};
    projects.forEach(p => { map[p._id] = p.name || '(untitled project)'; });
    return map;
  }, [projects]);
  if (sub() || subProjects()) return <div>Loading…</div>;
  return (
    <div>
      <h2>Files</h2>
      <Card>
        {files.length === 0 ? (
          <div>No files yet.</div>
        ) : (
          <div>
            {(() => {
              const byId = new Map();
              files.forEach(f => { const pid = f.projectId || '__none__'; if (!byId.has(pid)) byId.set(pid, []); byId.get(pid).push(f); });
              const groups = Array.from(byId.entries()).map(([pid, arr]) => ({
                projectId: pid === '__none__' ? null : pid,
                name: pid === '__none__' ? '(no project)' : (projectNameById[pid] || '(untitled project)'),
                items: arr
              })).sort((a, b) => {
                const aNone = a.projectId ? 1 : 0;
                const bNone = b.projectId ? 1 : 0;
                if (aNone !== bNone) return aNone - bNone;
                return a.name.localeCompare(b.name);
              });
              return (
                <>
                  {groups.map((g) => (
                    <div key={g.projectId || '__none__'}>
                      <div className="fileGroupHeader">
                        {g.projectId ? (
                          <a
                            className="fileProject"
                            href={`#/projects/${g.projectId}`}
                            onClick={(e) => { e.preventDefault(); navigateTo({ name: 'project', projectId: g.projectId }); }}
                            title={g.name}
                          >
                            {g.name}
                          </a>
                        ) : (
                          <span className="fileProject">(no project)</span>
                        )}
                      </div>
                      <ul className="filesList">
                        {g.items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map((f) => (
                          <li key={f._id}>
                            <div className="fileRow">
                              <span className="fileCell">
                                <FileItem file={f} />
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        )}
      </Card>
    </div>
  );
};


