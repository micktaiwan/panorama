import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './NoteEditor.css';

export const NoteEditor = ({ activeTabId, noteContents, onContentChange, onSave, onSaveAll, onClose, isSaving }) => {
  const textAreaRef = useRef(null);
  const pendingSelectionRef = useRef(null);

  useEffect(() => {
    if (!activeTabId) return;
    const sel = pendingSelectionRef.current;
    if (sel && textAreaRef.current) {
      const ta = textAreaRef.current;
      try {
        ta.setSelectionRange(sel.start, sel.end);
      } finally {
        pendingSelectionRef.current = null;
      }
    }
  }, [noteContents, activeTabId]);

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
          ref={textAreaRef}
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
            } else if (key === 'tab') {
              e.preventDefault();
              const textarea = e.target;
              const value = String(textarea.value || '');
              const start = textarea.selectionStart || 0;
              const end = textarea.selectionEnd || 0;
              const isShift = e.shiftKey;
              const indent = '\t'; // real tab character

              const selected = value.slice(start, end);
              const isMultiline = selected.includes('\n');

              if (isMultiline) {
                // Multi-line indent/unindent
                const before = value.slice(0, start);
                const after = value.slice(end);
                const lines = selected.split('\n');
                let newSelected;
                if (isShift) {
                  newSelected = lines
                    .map(line => (line.startsWith(indent) ? line.slice(indent.length) : line.replace(/^(\t| {1,2})/, '')))
                    .join('\n');
                } else {
                  newSelected = lines.map(line => indent + line).join('\n');
                }
                const next = before + newSelected + after;
                onContentChange(activeTabId, next);
                const delta = newSelected.length - selected.length;
                pendingSelectionRef.current = { start, end: end + delta };
              } else {
                // Single-line: insert/remove a tab at the caret or over selection
                const before = value.slice(0, start);
                const after = value.slice(end);
                if (isShift) {
                  // Unindent: remove a preceding tab or up to two spaces
                  let newStart = start;
                  let newBefore = before;
                  if (before.endsWith('\t')) {
                    newBefore = before.slice(0, -1);
                    newStart -= 1;
                  } else {
                    const m = / {1,2}$/.exec(before);
                    const removed = m ? m[0].length : 0;
                    if (removed > 0) {
                      newBefore = before.slice(0, -removed);
                      newStart -= removed;
                    }
                  }
                  const next = newBefore + after;
                  onContentChange(activeTabId, next);
                  pendingSelectionRef.current = { start: newStart, end: newStart };
                } else {
                  // Insert a tab character at caret, replacing selection if any
                  const next = before + indent + after;
                  onContentChange(activeTabId, next);
                  pendingSelectionRef.current = { start: start + indent.length, end: start + indent.length };
                }
              }
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
