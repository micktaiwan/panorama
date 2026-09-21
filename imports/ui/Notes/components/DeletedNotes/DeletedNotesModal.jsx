import React, { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import './DeletedNotesModal.css';

// Deleting a note is a hard delete: its revisions are then the only remaining
// copy of its text. This lists those orphan histories, reads them, and brings
// a note back with its original id.
export const DeletedNotesModal = ({ open, onClose, onRestored }) => {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busyNoteId, setBusyNoteId] = useState(null);

  const load = useCallback(() => {
    setIsLoading(true);
    Meteor.call('noteRevisions.deletedNotes', (err, result) => {
      setIsLoading(false);
      if (err) {
        console.error('noteRevisions.deletedNotes failed', err);
        notify({ message: 'Could not load deleted notes', kind: 'error' });
        return;
      }
      setRows(result || []);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setExpandedId(null);
    setPreview(null);
    load();
  }, [open, load]);

  const handleExpand = (row) => {
    if (expandedId === row.noteId) {
      setExpandedId(null);
      setPreview(null);
      return;
    }
    setExpandedId(row.noteId);
    setPreview(null);
    Meteor.call('noteRevisions.get', row.lastRevisionId, (err, revision) => {
      if (err) {
        console.error('noteRevisions.get failed', err);
        notify({ message: 'Could not load this version', kind: 'error' });
        return;
      }
      setPreview(revision);
    });
  };

  const handleRestore = (row) => {
    setBusyNoteId(row.noteId);
    Meteor.call('noteRevisions.restoreDeletedNote', row.noteId, null, (err) => {
      setBusyNoteId(null);
      if (err) {
        console.error('noteRevisions.restoreDeletedNote failed', err);
        notify({ message: `Could not restore: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      notify({ message: 'Note restored', kind: 'success' });
      onRestored?.(row.noteId);
      onClose();
    });
  };

  const handlePurge = (row) => {
    setBusyNoteId(row.noteId);
    Meteor.call('noteRevisions.purge', row.noteId, (err, removed) => {
      setBusyNoteId(null);
      if (err) {
        console.error('noteRevisions.purge failed', err);
        notify({ message: 'Could not clear this history', kind: 'error' });
        return;
      }
      notify({ message: `Cleared ${removed} version${removed === 1 ? '' : 's'}`, kind: 'success' });
      setExpandedId(null);
      setPreview(null);
      load();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deleted notes"
      icon={false}
      actions={[<button key="close" type="button" className="btn" onClick={onClose}>Close</button>]}
    >
      <p className="deleted-notes-intro">
        These notes were deleted, but their version history was kept. Restoring one brings it back
        with its original link and history.
      </p>

      {isLoading && <div className="deleted-notes-empty">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="deleted-notes-empty">No deleted note has a kept history.</div>
      )}

      <div className="deleted-notes-list">
        {rows.map((row) => (
          <div key={row.noteId} className={`deleted-note-item${expandedId === row.noteId ? ' expanded' : ''}`}>
            <button type="button" className="deleted-note-head" onClick={() => handleExpand(row)}>
              <span className="deleted-note-title">{row.title || '(untitled)'}</span>
              <span className="deleted-note-meta">
                {row.revisionCount} version{row.revisionCount === 1 ? '' : 's'} · last {formatDateTime(row.lastRevisionAt)}
              </span>
            </button>

            {expandedId === row.noteId && (
              <div className="deleted-note-detail">
                {!preview && <div className="deleted-notes-empty">Loading…</div>}
                {preview && (
                  <pre className="deleted-note-preview">{preview.content || '(empty)'}</pre>
                )}
                <div className="deleted-note-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleRestore(row)}
                    disabled={busyNoteId === row.noteId}
                  >
                    {busyNoteId === row.noteId ? 'Working…' : 'Restore note'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handlePurge(row)}
                    disabled={busyNoteId === row.noteId}
                  >
                    Clear history
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
};

DeletedNotesModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onRestored: PropTypes.func,
};
