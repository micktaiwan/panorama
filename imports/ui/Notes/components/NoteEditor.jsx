import React from 'react';
import PropTypes from 'prop-types';
import './NoteEditor.css';

export const NoteEditor = ({ activeTabId, noteContents, onContentChange, onSave, onSaveAll, onClose, isSaving }) => {
  if (!activeTabId) {
    return (
      <div className="note-editor-container">
        <div className="note-editor">
          <div style={{ padding: '20px', color: '#9ca3af' }}>
            No note selected
          </div>
        </div>
        <div className="notes-actions">
          <button disabled className="save-button">Save</button>
          <button disabled className="save-all-button">Save All</button>
        </div>
      </div>
    );
  }

  return (
    <div className="note-editor-container">
      <div className="note-editor">
        <textarea
          value={noteContents[activeTabId] || ''}
          onChange={(e) => onContentChange(activeTabId, e.target.value)}
          onKeyDown={(e) => {
            const key = String(e.key || '').toLowerCase();
            const hasMod = e.metaKey || e.ctrlKey;
            if (hasMod && key === 's') {
              e.preventDefault();
              onSave(activeTabId);
            } else if (hasMod && key === 'w') {
              e.preventDefault();
              if (typeof onClose === 'function') onClose(activeTabId);
            }
          }}
          placeholder="Start writing your note..."
          className="note-textarea"
        />
      </div>
      
      <div className="notes-actions">
        <button
          className="save-button"
          onClick={() => onSave(activeTabId)}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          className="save-all-button"
          onClick={onSaveAll}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save All'}
        </button>
      </div>
    </div>
  );
};

NoteEditor.propTypes = {
  activeTabId: PropTypes.string,
  noteContents: PropTypes.object.isRequired,
  onContentChange: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onSaveAll: PropTypes.func.isRequired,
  onClose: PropTypes.func,
  isSaving: PropTypes.bool.isRequired,
};
