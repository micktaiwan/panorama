import React from 'react';
import PropTypes from 'prop-types';
import { navigateTo } from '/imports/ui/router.js';
import './NotesList.css';

export const NotesList = ({ notes, filteredNotes, openTabs, activeTabId, projectNamesById, onNoteClick, onRequestClose }) => {
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
      <button
        key={note._id}
        className={`note-item ${openTabs.find(tab => tab.id === note._id) ? 'open' : ''} ${activeTabId === note._id ? 'active' : ''}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            // Cmd-Click or Ctrl-Click: open project
            if (note.projectId) {
              e.preventDefault();
              navigateTo({ name: 'project', projectId: note.projectId });
            }
          } else {
            // Normal click: open note
            onNoteClick(note);
          }
        }}
        onKeyDown={(e) => {
          const key = String(e.key || '').toLowerCase();
          const hasMod = e.metaKey || e.ctrlKey;
          if (hasMod && key === 'w') {
            e.preventDefault();
            const isOpen = !!openTabs.find(tab => tab.id === note._id);
            if (isOpen && typeof onRequestClose === 'function') onRequestClose(note._id);
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
    ));
  };

  return (
    <div className="notes-list">
      {renderContent()}
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
