import React from 'react';
import './NoteAIActions.css';

export const NoteAIActions = ({
  noteId,
  isDirty,
  isCleaning,
  isSummarizing,
  undoAvailable,
  onClean,
  onSummarize,
  onUndo,
}) => (
  <>
    <button
      className="action-button clean-button"
      onClick={onClean}
      disabled={isCleaning || !noteId || isDirty}
      title={isDirty ? 'Save the note before cleaning' : 'Clean note with AI'}
    >
      {isCleaning ? 'Cleaning...' : 'Clean'}
    </button>

    <button
      className="action-button summarize-button"
      onClick={onSummarize}
      disabled={isSummarizing || !noteId || isDirty}
      title={isDirty ? 'Save the note before summarizing' : 'Summarize note with AI'}
    >
      {isSummarizing ? 'Summarizing...' : 'Summarize'}
    </button>

    <button
      className="action-button undo-button"
      onClick={onUndo}
      disabled={!noteId || !undoAvailable}
      title={undoAvailable ? 'Undo last AI action' : 'No undo data available'}
    >
      Undo
    </button>
  </>
);
