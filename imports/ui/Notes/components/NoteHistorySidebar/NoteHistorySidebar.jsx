import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { NoteRevisionsCollection } from '/imports/api/noteRevisions/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import './NoteHistorySidebar.css';

const SOURCE_LABELS = { ui: 'Editor', mcp: 'MCP' };

// Every write that changed the body appends a revision holding the PREVIOUS
// body. Restoring is an ordinary save, so it appends a revision of its own.
export const NoteHistorySidebar = ({ noteId, onClose, onRestore, canWrite }) => {
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const { revisions, isLoading } = useTracker(() => {
    const sub = Meteor.subscribe('noteRevisions.byNote', noteId);
    return {
      revisions: NoteRevisionsCollection.find({ noteId }, { sort: { createdAt: -1 } }).fetch(),
      isLoading: !sub.ready(),
    };
  }, [noteId]);

  // Switching note resets the selection
  useEffect(() => {
    setSelectedId(null);
    setPreview(null);
  }, [noteId]);

  const handleSelect = (revisionId) => {
    if (selectedId === revisionId) {
      setSelectedId(null);
      setPreview(null);
      return;
    }
    setSelectedId(revisionId);
    setPreview(null);
    setIsLoadingPreview(true);
    Meteor.call('noteRevisions.get', revisionId, (err, revision) => {
      setIsLoadingPreview(false);
      if (err) {
        console.error('noteRevisions.get failed', err);
        notify({ message: 'Could not load this revision', kind: 'error' });
        return;
      }
      setPreview(revision);
    });
  };

  const handleRestore = (revisionId) => {
    setIsRestoring(true);
    Meteor.call('noteRevisions.get', revisionId, (err, revision) => {
      setIsRestoring(false);
      if (err) {
        console.error('noteRevisions.get failed', err);
        notify({ message: 'Could not load this revision', kind: 'error' });
        return;
      }
      onRestore(revision.content || '');
    });
  };

  const handlePurge = () => {
    setShowPurgeConfirm(false);
    Meteor.call('noteRevisions.purge', noteId, (err, removed) => {
      if (err) {
        console.error('noteRevisions.purge failed', err);
        notify({ message: 'Could not clear the history', kind: 'error' });
        return;
      }
      setSelectedId(null);
      setPreview(null);
      notify({ message: `Cleared ${removed} revision${removed === 1 ? '' : 's'}`, kind: 'success' });
    });
  };

  return (
    <div className="note-history-sidebar">
      <div className="note-history-header">
        <span className="note-history-title">Version history</span>
        <button type="button" className="note-history-close" onClick={onClose} aria-label="Close history">✕</button>
      </div>

      <div className="note-history-list scrollArea">
        {isLoading && <div className="note-history-empty">Loading…</div>}
        {!isLoading && revisions.length === 0 && (
          <div className="note-history-empty">
            No previous version yet. A revision is kept every time the body changes.
          </div>
        )}
        {revisions.map((rev) => (
          <div key={rev._id} className={`note-history-item${selectedId === rev._id ? ' selected' : ''}`}>
            <button
              type="button"
              className="note-history-item-head"
              onClick={() => handleSelect(rev._id)}
            >
              <span className="note-history-date">{formatDateTime(rev.createdAt)}</span>
              <span className={`note-history-source source-${rev.source}`}>
                {SOURCE_LABELS[rev.source] || rev.source}
              </span>
              <span className="note-history-size">{rev.contentLength ?? 0} chars</span>
            </button>

            {selectedId === rev._id && (
              <div className="note-history-detail">
                {isLoadingPreview && <div className="note-history-empty">Loading…</div>}
                {preview && preview._id === rev._id && (
                  <>
                    <pre className="note-history-preview">{preview.content || '(empty)'}</pre>
                    <div className="note-history-actions">
                      <Tooltip content="Replace the current body with this version (the current one is kept in history)">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleRestore(rev._id)}
                          disabled={!canWrite || isRestoring}
                        >
                          {isRestoring ? 'Restoring…' : 'Restore this version'}
                        </button>
                      </Tooltip>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="note-history-footer">
        <button
          type="button"
          className="btn note-history-purge"
          onClick={() => setShowPurgeConfirm(true)}
          disabled={revisions.length === 0}
        >
          Clear history
        </button>
      </div>

      <Modal
        open={showPurgeConfirm}
        onClose={() => setShowPurgeConfirm(false)}
        title="Clear version history"
        actions={[
          <button key="cancel" type="button" className="btn" onClick={() => setShowPurgeConfirm(false)}>Cancel</button>,
          <button key="purge" type="button" className="btn btn-primary" onClick={handlePurge}>Clear history</button>,
        ]}
      >
        {`This permanently deletes the ${revisions.length} stored version${revisions.length === 1 ? '' : 's'} of this note. The note itself is untouched. This cannot be undone.`}
      </Modal>
    </div>
  );
};

NoteHistorySidebar.propTypes = {
  noteId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onRestore: PropTypes.func.isRequired,
  canWrite: PropTypes.bool,
};
