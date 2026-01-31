import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { navigateTo } from '/imports/ui/router.js';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import './NotesList.css';

export const NotesList = ({ notes, filteredNotes, openTabs, activeTabId, projectNamesById, onNoteClick, onRequestClose }) => {
  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    const noteId = deleteTarget._id;
    // Close the tab if open
    if (openTabs.find(tab => tab.id === noteId) && typeof onRequestClose === 'function') {
      onRequestClose(noteId);
    }
    Meteor.call('notes.remove', noteId, (err) => {
      if (err) {
        notify({ message: 'Error deleting note', kind: 'error' });
      } else {
        notify({ message: 'Note deleted', kind: 'success' });
      }
    });
    setDeleteTarget(null);
  };

  const renderContent = () => {
    if (filteredNotes.length === 0 && notes.length === 0) {
      return (
        <div className="no-notes">
          <p>No notes found</p>
          <p>Create a note from a project or session</p>
        </div>
      );
    }

    if (filteredNotes.length === 0 && notes.length > 0) {
      return (
        <div className="no-results">
          <p>No notes match your search</p>
        </div>
      );
    }

    return filteredNotes.map(note => (
      <div key={note._id} className="note-item-row">
        <button
          className={`note-item ${openTabs.find(tab => tab.id === note._id) ? 'open' : ''} ${activeTabId === note._id ? 'active' : ''}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              if (note.projectId) {
                e.preventDefault();
                navigateTo({ name: 'project', projectId: note.projectId });
              }
            } else {
              onNoteClick(note);
            }
          }}
          type="button"
        >
          <div className="note-title">{note.title || 'Untitled'}</div>
          {note.projectId ? (
            <span className="note-project">{projectNamesById?.[note.projectId] || '—'}</span>
          ) : null}
          <div className="note-date">
            {(() => {
              if (note.updatedAt) {
                return new Date(note.updatedAt).toLocaleDateString();
              }
              if (note.createdAt) {
                return new Date(note.createdAt).toLocaleDateString();
              }
              return '';
            })()}
          </div>
        </button>
        <button
          className="note-delete-btn"
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(note); }}
          title="Delete note"
          type="button"
        >
          &#128465;
        </button>
      </div>
    ));
  };

  return (
    <div className="notes-list">
      {renderContent()}

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete note"
        actions={[
          <button key="cancel" className="btn" type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>,
          <button key="delete" className="btn btn-primary" type="button" onClick={handleDelete}>Delete</button>,
        ]}
      >
        Delete &quot;{deleteTarget?.title || 'Untitled'}&quot;? This cannot be undone.
      </Modal>
    </div>
  );
};

NotesList.propTypes = {
  notes: PropTypes.array.isRequired,
  filteredNotes: PropTypes.array.isRequired,
  openTabs: PropTypes.array.isRequired,
  activeTabId: PropTypes.string,
  projectNamesById: PropTypes.object,
  onNoteClick: PropTypes.func.isRequired,
  onRequestClose: PropTypes.func,
};
