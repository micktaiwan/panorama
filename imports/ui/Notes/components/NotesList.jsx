import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { navigateTo } from '/imports/ui/router.js';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import './NotesList.css';

const SortableNoteItem = ({ note, openTabs, activeTabId, projectNamesById, onNoteClick, onDeleteClick }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`note-item-row ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <button
        className={`note-item ${openTabs.find(tab => tab.id === note._id) ? 'open' : ''} ${activeTabId === note._id ? 'active' : ''} ${note.claudeProjectId ? 'claude-project' : ''}`}
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
        <div className="note-title">
          {note.claudeProjectId && (
            <svg className="note-claude-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm2.5 6.5L6.5 8 4.5 6.5M8 9.5h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {note.title || 'Untitled'}
        </div>
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
        onClick={(e) => { e.stopPropagation(); onDeleteClick(note); }}
        title="Delete note"
        type="button"
      >
        &#128465;
      </button>
    </div>
  );
};

SortableNoteItem.propTypes = {
  note: PropTypes.object.isRequired,
  openTabs: PropTypes.array.isRequired,
  activeTabId: PropTypes.string,
  projectNamesById: PropTypes.object,
  onNoteClick: PropTypes.func.isRequired,
  onDeleteClick: PropTypes.func.isRequired,
};

export const NotesList = ({ notes, filteredNotes, openTabs, activeTabId, projectNamesById, onNoteClick, onRequestClose, onReorderNote }) => {
  const [deleteTarget, setDeleteTarget] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

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

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderNote) return;

    const oldIndex = filteredNotes.findIndex(n => n._id === active.id);
    const newIndex = filteredNotes.findIndex(n => n._id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Calculate the new updatedAt value
    let newUpdatedAt;
    if (newIndex === 0) {
      // Dropped at first position: newer than the current first
      newUpdatedAt = new Date(Date.now());
    } else if (newIndex === filteredNotes.length - 1) {
      // Dropped at last position: older than the current last
      const lastNote = filteredNotes[filteredNotes.length - 1];
      const lastUpdatedAt = lastNote.updatedAt || lastNote.createdAt;
      newUpdatedAt = new Date(new Date(lastUpdatedAt).getTime() - 1);
    } else {
      // Dropped between two notes: average of adjacent notes
      const prevNote = newIndex < oldIndex ? filteredNotes[newIndex] : filteredNotes[newIndex + 1];
      const nextNote = newIndex < oldIndex ? filteredNotes[newIndex - 1] : filteredNotes[newIndex];
      const prevTime = new Date(prevNote.updatedAt || prevNote.createdAt).getTime();
      const nextTime = new Date(nextNote.updatedAt || nextNote.createdAt).getTime();
      newUpdatedAt = new Date(Math.floor((prevTime + nextTime) / 2));
    }

    onReorderNote(active.id, newUpdatedAt);
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

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredNotes.map(n => n._id)}
          strategy={verticalListSortingStrategy}
        >
          {filteredNotes.map(note => (
            <SortableNoteItem
              key={note._id}
              note={note}
              openTabs={openTabs}
              activeTabId={activeTabId}
              projectNamesById={projectNamesById}
              onNoteClick={onNoteClick}
              onDeleteClick={setDeleteTarget}
            />
          ))}
        </SortableContext>
      </DndContext>
    );
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
  onReorderNote: PropTypes.func,
};
