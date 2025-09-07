import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { LinksCollection } from '../../api/links/collections';
import { ProjectsCollection } from '../../api/projects/collections';
import { Card } from '../components/Card/Card.jsx';
import { LinkItem } from '../components/Link/Link.jsx';
import { createNewLink } from '../utils/links.js';
import './LinksPage.css';
import { navigateTo } from '../router.js';

export const LinksPage = () => {
  const sub = useSubscribe('links');
  const subProjects = useSubscribe('projects');
  const links = useFind(() => LinksCollection.find({}, { sort: { createdAt: -1 } }));
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1 } }));
  const projectNameById = React.useMemo(() => {
    const map = {};
    projects.forEach(p => { map[p._id] = p.name || '(untitled project)'; });
    return map;
  }, [projects]);
  if (sub() || subProjects()) return <div>Loading…</div>;
  return (
    <div>
      <h2>Links</h2>
      <div className="homeToolbar">
        <button className="btn btn-primary" onClick={() => createNewLink(undefined, (id) => {
          // Optional: nothing needed, new link appears first with default name; edit inline handled by LinkItem via startEditing when freshly created if we detect it below.
        })}>Add a link</button>
      </div>
      <Card>
        {links.length === 0 ? (
          <div>No links yet.</div>
        ) : (
          <div>
            {(() => {
              const byId = new Map();
              links.forEach(l => { const pid = l.projectId || '__none__'; if (!byId.has(pid)) byId.set(pid, []); byId.get(pid).push(l); });
              const groups = Array.from(byId.entries()).map(([pid, arr]) => ({
                projectId: pid === '__none__' ? null : pid,
                name: pid === '__none__' ? '(no project)' : (projectNameById[pid] || '(untitled project)'),
                items: arr
              })).sort((a, b) => {
                // Put (no project) group first, then by project name
                const aNone = a.projectId ? 1 : 0;
                const bNone = b.projectId ? 1 : 0;
                if (aNone !== bNone) return aNone - bNone; // 0 (none) first
                return a.name.localeCompare(b.name);
              });
              return (
                <>
                  {groups.map((g, gIdx) => (
                    <div key={g.projectId || '__none__'}>
                      <div className="linkGroupHeader">
                        {g.projectId ? (
                          <a
                            className="linkProject"
                            href={`#/projects/${g.projectId}`}
                            onClick={(e) => { e.preventDefault(); navigateTo({ name: 'project', projectId: g.projectId }); }}
                            title={g.name}
                          >
                            {g.name}
                          </a>
                        ) : (
                          <span className="linkProject">(no project)</span>
                        )}
                      </div>
                      <ul className="linksList">
                        {g.items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map((l, idx) => (
                          <li key={l._id}>
                            <div className="linkRow">
                              <span className="linkCell">
                                <LinkItem link={l} startEditing={gIdx === 0 && idx === 0 && (l.name === 'New Link')} />
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


