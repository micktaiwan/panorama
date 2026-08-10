import React from 'react';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
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
    <Tooltip content={isDirty ? 'Save the note before cleaning' : 'Clean note with AI'}>
      <button
        className="action-button clean-button"
        onClick={onClean}
        disabled={isCleaning || !noteId || isDirty}
      >
        {isCleaning ? 'Cleaning...' : 'Clean'}
      </button>
    </Tooltip>

    <Tooltip content={isDirty ? 'Save the note before summarizing' : 'Summarize note with AI'}>
      <button
        className="action-button summarize-button"
        onClick={onSummarize}
        disabled={isSummarizing || !noteId || isDirty}
      >
        {isSummarizing ? 'Summarizing...' : 'Summarize'}
      </button>
    </Tooltip>

    <Tooltip content={undoAvailable ? 'Undo last AI action' : 'No undo data available'}>
      <button
        className="action-button undo-button"
        onClick={onUndo}
        disabled={!noteId || !undoAvailable}
      >
        Undo
      </button>
    </Tooltip>
  </>
);
