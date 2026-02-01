import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { formatDateTime } from '/imports/ui/utils/date.js';
import { navigateTo } from '/imports/ui/router.js';
import { CleanPromptModal } from './CleanPromptModal.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { ProseMirrorEditor } from './ProseMirrorEditor/ProseMirrorEditor.jsx';
import { AskAiSidebar } from './AskAiSidebar/AskAiSidebar.jsx';
import { NoteAIActions } from './NoteAIActions/NoteAIActions.jsx';
import { useNoteAI } from '../hooks/useNoteAI.js';
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
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const editorRef = useRef(null);

  const {
    isCleaning, isSummarizing, undoAvailable, showCleanModal, askAiSessionId,
    handleCleanNote, handleCleanConfirm, handleSummarizeNote, handleUndo,
    handleAskAI, handleCloseAskAi, setShowCleanModal,
    getNoteContent, getSelectedText, handleReplace, handleInsertBelow,
  } = useNoteAI({
    noteId: activeTabId,
    editorRef,
    isDirty: dirtySet.has(activeTabId),
    onContentUpdate: onContentChange,
    getCurrentContent: () => noteContents[activeTabId] || '',
  });

  const handleDuplicateNote = () => {
    if (!activeTabId || !onDuplicate) return;
    onDuplicate(activeTabId);
  };

  const handleMoveProject = (projectId) => {
    if (!activeTabId || !onMoveProject) return;
    onMoveProject(activeTabId, projectId);
  };

  // Handle Cmd+W close with dirty check
  const handleClose = () => {
    if (dirtySet.has(activeTabId)) {
      setShowCloseConfirm(true);
    } else {
      if (typeof onClose === 'function') onClose(activeTabId);
    }
  };

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
            {activeNote?.claudeProjectId && (
              <button
                className="action-button claude-project-button"
                onClick={() => navigateTo({ name: 'claude', projectId: activeNote.claudeProjectId })}
                title="Open Claude Code project"
              >
                Claude Code
              </button>
            )}

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

            <NoteAIActions
              noteId={activeTabId}
              isDirty={dirtySet.has(activeTabId)}
              isCleaning={isCleaning}
              isSummarizing={isSummarizing}
              undoAvailable={undoAvailable}
              onClean={handleCleanNote}
              onSummarize={handleSummarizeNote}
              onUndo={handleUndo}
            />

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
    claudeProjectId: PropTypes.string,
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
