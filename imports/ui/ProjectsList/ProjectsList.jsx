import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import './ProjectsList.css';

export const ProjectsList = ({ onSelectProject }) => {
  const isLoading = useSubscribe('projects');
  const projects = useFind(() => ProjectsCollection.find({}, { sort: { updatedAt: -1 } }));

  if (isLoading()) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="projectsListHeader">
        <h2>Projects</h2>
      </div>
      <ul>
        {projects.map(p => (
          <li key={p._id}>
            <a
              href={`#/projects/${p._id}`}
              className="projectLink"
              onClick={(e) => {
                e.preventDefault();
                onSelectProject(p._id);
              }}
            >
              {p.name || '(untitled project)'}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};


