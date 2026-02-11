import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { NotesCollection } from '/imports/api/notes/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { ProseMirrorEditor } from '/imports/ui/Notes/components/ProseMirrorEditor/ProseMirrorEditor.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { CleanPromptModal } from '/imports/ui/Notes/components/CleanPromptModal.jsx';
import { AskAiSidebar } from '/imports/ui/Notes/components/AskAiSidebar/AskAiSidebar.jsx';
import { NoteAIActions } from '/imports/ui/Notes/components/NoteAIActions/NoteAIActions.jsx';
import { useNoteAI } from '/imports/ui/Notes/hooks/useNoteAI.js';
import { notify } from '/imports/ui/utils/notify.js';
import './NotePanel.css';

export const NotePanel = ({ noteId, claudeProjectId }) => {
  const [dirty, setDirty] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const editorRef = useRef(null);
  const contentRef = useRef(null); // tracks latest editor content for save

  useSubscribe('notes.byClaudeProject', claudeProjectId || '__none__');

  const notes = useFind(() =>
    NotesCollection.find(
      { _id: noteId },
      { fields: { title: 1, content: 1, createdAt: 1, updatedAt: 1 } }
    ),
    [noteId]
  );
  const note = notes[0];

  const doSave = useCallback(() => {
    if (!noteId || contentRef.current === null) return;
    const content = contentRef.current;
    Meteor.call('notes.update', noteId, { content }, (err) => {
      if (err) {
        notify({ message: `Save failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setDirty(false);
    });
  }, [noteId]);

  const handleChange = useCallback((md) => {
    contentRef.current = md;
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    doSave();
  }, [doSave]);

  const onContentUpdate = useCallback((id, content) => {
    contentRef.current = content;
    setDirty(true);
  }, []);

  const {
    isCleaning, isSummarizing, undoAvailable, showCleanModal, askAiSessionId,
    handleCleanNote, handleCleanConfirm, handleSummarizeNote, handleUndo,
    handleAskAI, handleCloseAskAi, setShowCleanModal,
    getNoteContent, getSelectedText, handleReplace, handleInsertBelow,
  } = useNoteAI({
    noteId,
    editorRef,
    isDirty: dirty,
    onContentUpdate,
  });

  // Auto-save on blur (editor loses focus)
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;

    const handleBlur = () => {
      if (contentRef.current !== null && dirty) {
        doSave();
      }
    };

    view.dom.addEventListener('blur', handleBlur);
    return () => view.dom.removeEventListener('blur', handleBlur);
  }, [noteId, dirty, doSave]);

  // Auto-save on unmount (switching tabs)
  useEffect(() => {
    return () => {
      if (contentRef.current !== null) {
        // Fire-and-forget save on unmount
        Meteor.call('notes.update', noteId, { content: contentRef.current });
      }
    };
  }, [noteId]);

  const handleDelete = useCallback(() => {
    if (!noteId) return;
    Meteor.call('notes.remove', noteId, (err) => {
      if (err) {
        notify({ message: `Delete failed: ${err.reason || err.message}`, kind: 'error' });
      }
      setShowDeleteConfirm(false);
    });
  }, [noteId]);

  if (!note) {
    return (
      <div className="ccNotePanel">
        <div className="ccNotePanelEmpty muted">Note not found</div>
      </div>
    );
  }

  return (
    <div className="ccNotePanel">
      <div className="ccNotePanelHeader">
        <InlineEditable
          value={note.title || 'Untitled'}
          className="ccNotePanelTitle"
          onSubmit={(title) => {
            Meteor.call('notes.update', noteId, { title }, (err) => {
              if (err) notify({ message: `Rename failed: ${err.reason || err.message}`, kind: 'error' });
            });
          }}
        />
        <div className="ccNotePanelActions">
          {dirty && <span className="ccNotePanelDirty">unsaved</span>}
          <NoteAIActions
            noteId={noteId}
            isDirty={dirty}
            isCleaning={isCleaning}
            isSummarizing={isSummarizing}
            undoAvailable={undoAvailable}
            onClean={handleCleanNote}
            onSummarize={handleSummarizeNote}
            onUndo={handleUndo}
          />
          <button
            className="btn btn-small"
            onClick={handleSave}
            disabled={!dirty}
          >
            Save
          </button>
          <button
            className="btn btn-small btn-danger"
            onClick={(e) => e.shiftKey ? handleDelete() : setShowDeleteConfirm(true)}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="ccNotePanelBody">
        <div className="ccNotePanelEditor">
          <ProseMirrorEditor
            ref={editorRef}
            key={noteId}
            content={note.content ?? ''}
            onChange={handleChange}
            onSave={handleSave}
            onAskAI={handleAskAI}
            shouldFocus
          />
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

      <CleanPromptModal
        open={showCleanModal}
        onClose={() => setShowCleanModal(false)}
        onConfirm={handleCleanConfirm}
        noteContent={note.content ?? ''}
      />

      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete note"
        actions={[
          <button key="cancel" className="btn" type="button" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>,
          <button key="delete" className="btn btn-danger" type="button" onClick={handleDelete}>Delete</button>,
        ]}
      >
        Are you sure you want to delete this note?
      </Modal>
    </div>
  );
};
