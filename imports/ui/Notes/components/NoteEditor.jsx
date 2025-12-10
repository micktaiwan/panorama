import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import { CleanPromptModal } from './CleanPromptModal.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './NoteEditor.css';
import { marked } from 'marked';
import { htmlToMarkdown } from '/imports/ui/utils/htmlPaste.js';

// Constants
const FOCUS_TIMEOUT_MS = 50;

export const NoteEditor = ({ 
  activeTabId, 
  noteContents, 
  onContentChange, 
  onSave, 
  onSaveAll, 
  onClose, 
  isSaving,
  activeNote,
  projectOptions = [],
  onMoveProject,
  onDuplicate,
  shouldFocus = false,
  dirtySet = new Set()
}) => {
  const textAreaRef = useRef(null);
  const pendingSelectionRef = useRef(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [showCleanModal, setShowCleanModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [splitPreview, setSplitPreview] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('notes.splitPreview') === 'true';
    }
    return false;
  });

  const renderedHtml = useMemo(() => {
    const map = (noteContents && typeof noteContents === 'object') ? noteContents : {};
    const key = String(activeTabId || '');
    const md = Object.hasOwn(map, key) ? String(map[key] ?? '') : '';
    return marked.parse(md);
  }, [activeTabId, noteContents]);

  const handleCleanNote = () => {
    if (!activeTabId || isCleaning) return;
    
    // Check if note has unsaved changes
    if (dirtySet.has(activeTabId)) {
      notify({ message: 'Please save the note before cleaning it', kind: 'error' });
      return;
    }
    
    // Open the clean prompt modal
    setShowCleanModal(true);
  };

  const handleCleanConfirm = (customPrompt) => {
    if (!activeTabId) return;
    
    // Save current content for undo functionality
    const undoKey = `note:undo:${activeTabId}`;
    const currentContent = noteContents[activeTabId] || '';
    
    if (typeof window !== 'undefined') {
      // Store timestamp and content for undo
      const undoData = {
        timestamp: Date.now(),
        content: currentContent,
        action: 'clean'
      };
      sessionStorage.setItem(undoKey, JSON.stringify(undoData));
      setUndoAvailable(true);
    }
    
    setIsCleaning(true);
    Meteor.call('ai.cleanNote', activeTabId, customPrompt, (err) => {
      console.log('ai.cleanNote result', err);
      setIsCleaning(false);
      if (err) {
        console.error('ai.cleanNote failed', err);
        notify({ message: 'Error cleaning note', kind: 'error' });
        return;
      }
      notify({ message: 'Note cleaned successfully. Press Cmd-Z to undo.', kind: 'success' });
    });
  };

  const handleSummarizeNote = () => {
    if (!activeTabId || isSummarizing) return;
    
    // Check if note has unsaved changes
    if (dirtySet.has(activeTabId)) {
      notify({ message: 'Please save the note before summarizing it', kind: 'error' });
      return;
    }
    
    // Save current content for undo functionality
    const undoKey = `note:undo:${activeTabId}`;
    const currentContent = noteContents[activeTabId] || '';
    
    if (typeof window !== 'undefined') {
      // Store timestamp and content for undo
      const undoData = {
        timestamp: Date.now(),
        content: currentContent,
        action: 'summarize'
      };
      sessionStorage.setItem(undoKey, JSON.stringify(undoData));
      setUndoAvailable(true);
    }
    
    setIsSummarizing(true);
    Meteor.call('ai.summarizeNote', activeTabId, (err) => {
      setIsSummarizing(false);
      if (err) {
        console.error('ai.summarizeNote failed', err);
        notify({ message: 'Error summarizing note', kind: 'error' });
        return;
      }
      notify({ message: 'Note summarized successfully. Press Cmd-Z to undo.', kind: 'success' });
    });
  };

  const handleDuplicateNote = () => {
    if (!activeTabId || !onDuplicate) return;
    onDuplicate(activeTabId);
  };

  const handleMoveProject = (projectId) => {
    if (!activeTabId || !onMoveProject) return;
    onMoveProject(activeTabId, projectId);
  };

  const handleUndo = () => {
    if (!activeTabId) return;
    
    const undoKey = `note:undo:${activeTabId}`;
    if (typeof window === 'undefined') return;
    
    const undoDataStr = sessionStorage.getItem(undoKey);
    if (!undoDataStr) {
      notify({ message: 'No undo data available', kind: 'warning' });
      return;
    }
    
    try {
      const undoData = JSON.parse(undoDataStr);
      const { content, action } = undoData;
      
      // Restore the previous content
      onContentChange(activeTabId, content);
      
      // Remove the undo data after using it
      sessionStorage.removeItem(undoKey);
      setUndoAvailable(false);
      
      notify({ message: `Undid ${action} action`, kind: 'success' });
    } catch (error) {
      console.error('Error parsing undo data:', error);
      notify({ message: 'Error restoring previous version', kind: 'error' });
    }
  };

  const hasUndoData = () => {
    if (!activeTabId || typeof window === 'undefined') return false;
    const undoKey = `note:undo:${activeTabId}`;
    return !!sessionStorage.getItem(undoKey);
  };

  // Update undo availability when activeTabId changes
  useEffect(() => {
    setUndoAvailable(hasUndoData());
  }, [activeTabId]);

  // Focus the textarea when shouldFocus is true
  useEffect(() => {
    if (shouldFocus && activeTabId) {
      // Use a small delay to ensure the textarea is fully mounted and available
      const timer = setTimeout(() => {
        if (textAreaRef.current) {
          textAreaRef.current.focus();
        }
      }, FOCUS_TIMEOUT_MS);
      
      return () => clearTimeout(timer);
    }
  }, [shouldFocus, activeTabId]);

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
        <div className={`note-editor${splitPreview ? ' split' : ''}`}>
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
      <div className={`note-editor${splitPreview ? ' split' : ''}`}>
        <textarea
          ref={textAreaRef}
          value={noteContents[activeTabId] || ''}
          onChange={(e) => onContentChange(activeTabId, e.target.value)}
          onPaste={(e) => {
            const html = e.clipboardData?.getData('text/html');
            const markdown = htmlToMarkdown(html);

            if (markdown) {
              e.preventDefault();
              const textarea = e.target;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const value = textarea.value;
              const newValue = value.slice(0, start) + markdown + value.slice(end);
              onContentChange(activeTabId, newValue);

              // Positionner le curseur après le texte collé
              const newPos = start + markdown.length;
              pendingSelectionRef.current = { start: newPos, end: newPos };
            }
            // Si pas de HTML formaté, laisser le comportement par défaut (coller texte brut)
          }}
          onKeyDown={(e) => {
            const key = String(e.key || '').toLowerCase();
            const hasMod = e.metaKey || e.ctrlKey;
            if (hasMod && key === 's') {
              e.preventDefault();
              onSave(activeTabId);
            } else if (hasMod && key === 'z') {
              e.preventDefault();
              handleUndo();
            } else if (hasMod && key === 'w') {
              e.preventDefault();
              // Check if note has unsaved changes before closing
              if (dirtySet.has(activeTabId)) {
                setShowCloseConfirm(true);
              } else {
                if (typeof onClose === 'function') onClose(activeTabId);
              }
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
        {splitPreview && (
          <div className="note-preview aiMarkdown webMarkdown" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        )}
      </div>
      
      <div className="notes-actions">
        <div className="notes-actions-left">
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
          <button
            className="action-button"
            onClick={() => {
              const next = !splitPreview;
              setSplitPreview(next);
              if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem('notes.splitPreview', String(next));
              }
            }}
            title="Toggle Markdown preview"
          >
            Split View
          </button>
        </div>
        
        <div className="notes-actions-center">
          {activeNote && (
            <div className="note-metadata">
              <span className="metadata-item">
                Created: {formatDateTime(activeNote.createdAt)}
              </span>
              {activeNote.updatedAt && activeNote.updatedAt !== activeNote.createdAt && (
                <span className="metadata-item">
                  Updated: {formatDateTime(activeNote.updatedAt)}
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="notes-actions-right">
          {projectOptions.length > 0 && (
            <InlineEditable
              as="select"
              value={activeNote?.projectId || ''}
              options={[{ value: '', label: '(no project)' }, ...projectOptions]}
              className="project-select"
              inputClassName="project-select"
              onSubmit={(projectId) => handleMoveProject(projectId || null)}
            />
          )}
          
          <button
            className="action-button clean-button"
            onClick={handleCleanNote}
            disabled={isCleaning || !activeTabId || dirtySet.has(activeTabId)}
            title={dirtySet.has(activeTabId) ? "Save the note before cleaning" : "Clean note with AI"}
          >
            {isCleaning ? 'Cleaning...' : 'Clean'}
          </button>
          
          <button
            className="action-button summarize-button"
            onClick={handleSummarizeNote}
            disabled={isSummarizing || !activeTabId || dirtySet.has(activeTabId)}
            title={dirtySet.has(activeTabId) ? "Save the note before summarizing" : "Summarize note with AI"}
          >
            {isSummarizing ? 'Summarizing...' : 'Summarize'}
          </button>
          
          <button
            className="action-button undo-button"
            onClick={handleUndo}
            disabled={!activeTabId || !undoAvailable}
            title={undoAvailable ? "Undo last AI action (Cmd-Z)" : "No undo data available"}
          >
            Undo
          </button>
          
          <button
            className="action-button duplicate-button"
            onClick={handleDuplicateNote}
            disabled={!activeTabId}
            title="Duplicate note"
          >
            Duplicate
          </button>
        </div>
      </div>
      
      <CleanPromptModal
        open={showCleanModal}
        onClose={() => setShowCleanModal(false)}
        onConfirm={handleCleanConfirm}
        defaultPrompt={`Rules for cleaning notes:
1. Remove all emojis.
2. Remove all markdown symbols (e.g. **, #, >, *) but keep the hierarchy: convert titles and subtitles to plain text lines.
3. Remove timestamps (e.g. "2 minutes ago", "9:14").
4. For email signatures: remove long blocks. Keep only the sender's name and date. Ignore job titles, phone numbers, or disclaimers.
5. Keep the conversation flow and speaker names if it's a dialogue.
6. Keep all original content, do NOT summarize, shorten, or translate.
7. Preserve the original language of the text.
8. Correct obvious spelling mistakes.
Output: plain text only, no markdown, no special formatting, no added text compared to the original`}
        noteContent={noteContents[activeTabId] || ''}
      />

      <Modal
        open={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        title="Unsaved changes"
        actions={[
          <button key="cancel" className="btn" type="button" onClick={() => setShowCloseConfirm(false)}>Cancel</button>,
          <button
            key="close"
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setShowCloseConfirm(false);
              if (typeof onClose === 'function') onClose(activeTabId);
            }}
          >
            Close without saving
          </button>,
        ]}
      >
        This note has unsaved changes. Are you sure you want to close it?
      </Modal>
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
  activeNote: PropTypes.shape({
    _id: PropTypes.string,
    title: PropTypes.string,
    content: PropTypes.string,
    projectId: PropTypes.string,
    createdAt: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
    updatedAt: PropTypes.oneOfType([PropTypes.instanceOf(Date), PropTypes.string, PropTypes.number]),
  }),
  projectOptions: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string,
    label: PropTypes.string,
  })),
  onMoveProject: PropTypes.func,
  onDuplicate: PropTypes.func,
  shouldFocus: PropTypes.bool,
  dirtySet: PropTypes.instanceOf(Set),
};
