import React, { useEffect, useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import { CleanPromptModal } from './CleanPromptModal.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { ProseMirrorEditor } from './ProseMirrorEditor/ProseMirrorEditor.jsx';
import { AskAiSidebar } from './AskAiSidebar/AskAiSidebar.jsx';
import { TextSelection } from 'prosemirror-state';
import { serializeMarkdown, parseMarkdown } from '../prosemirror/markdownIO.js';
import { askAiKey } from '../prosemirror/askAiPlugin.js';
import './NoteEditor.css';

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
  const [isCleaning, setIsCleaning] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [showCleanModal, setShowCleanModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [askAiSessionId, setAskAiSessionId] = useState(null);
  const askAiSessionIdRef = useRef(null);
  const editorRef = useRef(null);
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
      notify({ message: 'Note cleaned successfully. Use Undo button to revert.', kind: 'success' });
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
      notify({ message: 'Note summarized successfully. Use Undo button to revert.', kind: 'success' });
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

  // Keep ref in sync with state + clear highlight when sidebar closes
  useEffect(() => {
    askAiSessionIdRef.current = askAiSessionId;
    if (!askAiSessionId) {
      const view = editorRef.current?.view;
      if (view && askAiKey.getState(view.state)) {
        view.dispatch(view.state.tr.setMeta(askAiKey, null));
      }
    }
  }, [askAiSessionId]);

  // Cleanup Ask AI session when switching tabs
  useEffect(() => {
    return () => {
      if (askAiSessionIdRef.current) {
        Meteor.call('claudeSessions.remove', askAiSessionIdRef.current);
        setAskAiSessionId(null);
      }
    };
  }, [activeTabId]);

  // Handle Cmd+W close with dirty check
  const handleClose = () => {
    if (dirtySet.has(activeTabId)) {
      setShowCloseConfirm(true);
    } else {
      if (typeof onClose === 'function') onClose(activeTabId);
    }
  };

  // --- Ask AI handlers ---

  const handleAskAI = useCallback(({ from, to }) => {
    const view = editorRef.current?.view;
    if (!view) return;

    // Set the highlight decoration and collapse selection so the bubble menu hides
    const tr = view.state.tr
      .setMeta(askAiKey, { from, to })
      .setSelection(TextSelection.create(view.state.doc, to));
    view.dispatch(tr);

    // Create a new Claude session if we don't have one
    if (!askAiSessionId) {
      Meteor.call('claudeSessions.create', {
        name: 'Ask AI — Note',
        appendSystemPrompt: 'You are a helpful writing assistant. The user will provide their full note content and a selected portion. Answer their questions about the note or help them rewrite/improve the selected text. Respond concisely in the same language as the note. Output only the text content — no wrapping markdown fences, no explanations unless asked.',
      }, (err, newSessionId) => {
        if (err) {
          console.error('Failed to create Ask AI session:', err);
          notify({ message: 'Failed to start AI session', kind: 'error' });
          return;
        }
        setAskAiSessionId(newSessionId);
      });
    }
  }, [askAiSessionId]);

  const handleCloseAskAi = useCallback(() => {
    // Clear the highlight decoration
    const view = editorRef.current?.view;
    if (view) {
      const tr = view.state.tr.setMeta(askAiKey, null);
      view.dispatch(tr);
    }
    setAskAiSessionId(null);
  }, []);

  const getNoteContent = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return noteContents[activeTabId] || '';
    return serializeMarkdown(view.state.doc);
  }, [activeTabId, noteContents]);

  const getSelectedText = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return '';
    // Try to read from the tracked decoration first
    const tracked = askAiKey.getState(view.state);
    if (tracked) {
      return view.state.doc.textBetween(tracked.from, tracked.to, '\n');
    }
    // Fallback to current selection
    const { from, to, empty } = view.state.selection;
    if (empty) return '';
    return view.state.doc.textBetween(from, to, '\n');
  }, []);

  const handleReplace = useCallback((text) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const tracked = askAiKey.getState(view.state);
    if (!tracked) {
      notify({ message: 'No selection to replace', kind: 'warning' });
      return;
    }
    const { from, to } = tracked;
    // Parse the replacement text as markdown, then insert as a slice
    const newDoc = parseMarkdown(text);
    const fragment = newDoc.content;
    // Replace the tracked range and clear the decoration
    const tr = view.state.tr
      .replaceWith(from, to, fragment)
      .setMeta(askAiKey, null);
    view.dispatch(tr);
  }, []);

  const handleInsertBelow = useCallback((text) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const tracked = askAiKey.getState(view.state);
    const insertPos = tracked ? tracked.to : view.state.selection.to;
    // Wrap each paragraph in italic, sandwiched between horizontal rules
    const paragraphs = text.trim().split(/\n{2,}/);
    const italicText = paragraphs.map(p => `*${p.trim()}*`).join('\n\n');
    const wrappedMd = `---\n\n${italicText}\n\n---`;
    const newDoc = parseMarkdown(wrappedMd);
    const fragment = newDoc.content;
    const tr = view.state.tr.insert(insertPos, fragment);
    view.dispatch(tr);
  }, []);

  if (!activeTabId) {
    return (
      <div className="note-editor-container">
        <div className="note-editor-main">
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
      </div>
    );
  }

  return (
    <div className="note-editor-container">
      <div className="note-editor-main">
        <div className="note-editor">
          <ProseMirrorEditor
            ref={editorRef}
            key={activeTabId}
            content={noteContents[activeTabId] || ''}
            onChange={(md) => onContentChange(activeTabId, md)}
            onSave={() => onSave(activeTabId)}
            onClose={handleClose}
            onAskAI={handleAskAI}
            shouldFocus={shouldFocus}
          />
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
              title={undoAvailable ? "Undo last AI action" : "No undo data available"}
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

      {askAiSessionId && (
        <AskAiSidebar
          sessionId={askAiSessionId}
          onClose={handleCloseAskAi}
          getNoteContent={getNoteContent}
          getSelectedText={getSelectedText}
          onReplace={handleReplace}
          onInsertBelow={handleInsertBelow}
        />
      )}
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
