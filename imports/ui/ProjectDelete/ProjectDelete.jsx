import React, { useState } from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import './ProjectDelete.css';

export const ProjectDelete = ({ projectId, onBack }) => {
  const loadProjects = useSubscribe('projects');
  const loadTasks = useSubscribe('tasks');
  const loadSessions = useSubscribe('noteSessions');
  const loadNotes = useSubscribe('notes');
  const loadLines = useSubscribe('noteLines');
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const project = useFind(() => ProjectsCollection.find({ _id: projectId }))[0];
  const tasks = useFind(() => TasksCollection.find({ projectId }));
  const sessions = useFind(() => NoteSessionsCollection.find({ projectId }));
  const sessionIds = sessions.map(s => s._id);
  const lines = useFind(() => NoteLinesCollection.find(sessionIds.length ? { sessionId: { $in: sessionIds } } : { _id: '__none__' }));
  const notes = useFind(() => NotesCollection.find({ projectId }));

  if (loadProjects() || loadTasks() || loadSessions() || loadNotes() || loadLines()) {
    return <div>Loading...</div>;
  }

  if (!project) {
    return (
      <div>
        <button className="btn" onClick={onBack}>Back</button>
        <div>Project not found.</div>
      </div>
    );
  }

  const handleDelete = () => {
    setIsDeleting(true);
    Meteor.call('projects.remove', projectId, (err) => {
      setIsDeleting(false);
      if (err) return;
      if (typeof onBack === 'function') onBack();
    });
  };

  return (
    <div>
      <button className="btn" onClick={onBack}>Back</button>
      <h2>Delete project</h2>
      <Card title={`Project: ${project.name || '(untitled)'}`}>
        <p>Deleting this project will remove:</p>
        <div className="pdGrid">
          <div>Project</div><div><strong>1</strong></div>
          <div>Tasks</div><div><strong>{tasks.length}</strong></div>
          <div>Note sessions</div><div><strong>{sessions.length}</strong></div>
          <div>Note lines</div><div><strong>{lines.length}</strong></div>
          <div>Notes</div><div><strong>{notes.length}</strong></div>
        </div>
        <div role="alert" className="pdWarning">
          <strong>Warning:</strong> This action is irreversible. All listed data will be permanently removed.
        </div>
        <div className="pdFooter">
          <label className="pdConfirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I understand the consequences
          </label>
          <button className="btn btn-danger" onClick={handleDelete} disabled={!confirmed || isDeleting} aria-label={`Permanently delete project ${project.name || ''}`}>
            {isDeleting ? 'Deleting…' : 'Permanently delete project'}
          </button>
        </div>
      </Card>
    </div>
  );
};


