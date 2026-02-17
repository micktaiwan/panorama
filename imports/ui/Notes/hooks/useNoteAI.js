import { useEffect, useState, useRef, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { TextSelection } from 'prosemirror-state';
import { serializeMarkdown, parseMarkdown } from '../prosemirror/markdownIO.js';
import { askAiKey } from '../prosemirror/askAiPlugin.js';
import { notify } from '/imports/ui/utils/notify.js';

/**
 * Hook encapsulating all AI-related logic for note editing:
 * Clean, Summarize, Undo, and AskAI sidebar.
 *
 * @param {Object} params
 * @param {string} params.noteId - Current note ID
 * @param {Object} params.editorRef - React ref to ProseMirrorEditor
 * @param {boolean} params.isDirty - Whether the note has unsaved changes
 * @param {Function} params.onContentUpdate - Called as (noteId, content) when AI modifies content
 * @param {Function} [params.getCurrentContent] - Optional getter for current content (fallback: serialize from editor)
 */
export function useNoteAI({ noteId, editorRef, isDirty, onContentUpdate, getCurrentContent }) {
  const [isCleaning, setIsCleaning] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [showCleanModal, setShowCleanModal] = useState(false);
  const [askAiSessionId, setAskAiSessionId] = useState(null);
  const askAiSessionIdRef = useRef(null);
  const getCurrentContentRef = useRef(getCurrentContent);
  useEffect(() => { getCurrentContentRef.current = getCurrentContent; }, [getCurrentContent]);

  // --- Helpers ---

  const resolveContent = () => {
    if (getCurrentContentRef.current) return getCurrentContentRef.current();
    const view = editorRef.current?.view;
    if (view) return serializeMarkdown(view.state.doc);
    return '';
  };

  const hasUndoData = () => {
    if (!noteId || typeof window === 'undefined') return false;
    return !!sessionStorage.getItem(`note:undo:${noteId}`);
  };

  // --- Clean ---

  const handleCleanNote = () => {
    if (!noteId || isCleaning) return;
    if (isDirty) {
      notify({ message: 'Please save the note before cleaning it', kind: 'error' });
      return;
    }
    setShowCleanModal(true);
  };

  const handleCleanConfirm = (customPrompt) => {
    if (!noteId) return;

    const undoKey = `note:undo:${noteId}`;
    const currentContent = resolveContent();

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(undoKey, JSON.stringify({
        timestamp: Date.now(),
        content: currentContent,
        action: 'clean',
      }));
      setUndoAvailable(true);
    }

    setIsCleaning(true);
    Meteor.call('ai.cleanNote', noteId, customPrompt, (err, result) => {
      setIsCleaning(false);
      if (err) {
        console.error('ai.cleanNote failed', err);
        notify({ message: 'Error cleaning note', kind: 'error' });
        return;
      }
      if (result?.content != null) {
        editorRef.current?.setContent(result.content);
        onContentUpdate(noteId, result.content);
      }
      notify({ message: 'Note cleaned successfully. Use Undo button to revert.', kind: 'success' });
    });
  };

  // --- Summarize ---

  const handleSummarizeNote = () => {
    if (!noteId || isSummarizing) return;
    if (isDirty) {
      notify({ message: 'Please save the note before summarizing it', kind: 'error' });
      return;
    }

    const undoKey = `note:undo:${noteId}`;
    const currentContent = resolveContent();

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(undoKey, JSON.stringify({
        timestamp: Date.now(),
        content: currentContent,
        action: 'summarize',
      }));
      setUndoAvailable(true);
    }

    setIsSummarizing(true);
    Meteor.call('ai.summarizeNote', noteId, (err, result) => {
      setIsSummarizing(false);
      if (err) {
        console.error('ai.summarizeNote failed', err);
        notify({ message: 'Error summarizing note', kind: 'error' });
        return;
      }
      if (result?.content != null) {
        editorRef.current?.setContent(result.content);
        onContentUpdate(noteId, result.content);
      }
      notify({ message: 'Note summarized successfully. Use Undo button to revert.', kind: 'success' });
    });
  };

  // --- Undo ---

  const handleUndo = () => {
    if (!noteId) return;
    if (typeof window === 'undefined') return;

    const undoKey = `note:undo:${noteId}`;
    const undoDataStr = sessionStorage.getItem(undoKey);
    if (!undoDataStr) {
      notify({ message: 'No undo data available', kind: 'warning' });
      return;
    }

    try {
      const { content, action } = JSON.parse(undoDataStr);
      editorRef.current?.setContent(content);
      onContentUpdate(noteId, content);
      sessionStorage.removeItem(undoKey);
      setUndoAvailable(false);
      notify({ message: `Undid ${action} action`, kind: 'success' });
    } catch (error) {
      console.error('Error parsing undo data:', error);
      notify({ message: 'Error restoring previous version', kind: 'error' });
    }
  };

  // --- Ask AI ---

  const noteIdRef = useRef(noteId);
  useEffect(() => { noteIdRef.current = noteId; }, [noteId]);

  const handleAskAI = useCallback(({ from, to }) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const tr = view.state.tr
      .setMeta(askAiKey, { from, to })
      .setSelection(TextSelection.create(view.state.doc, to));
    view.dispatch(tr);

    if (!askAiSessionId) {
      const noteIdAtCall = noteIdRef.current;
      Meteor.call('claudeSessions.create', {
        name: 'Ask AI — Note',
        appendSystemPrompt: 'You are a helpful writing assistant. The user will provide their full note content and a selected portion. Answer their questions about the note or help them rewrite/improve the selected text. Respond concisely in the same language as the note. Output only the text content — no wrapping markdown fences, no explanations unless asked.',
      }, (err, newSessionId) => {
        if (err) {
          console.error('Failed to create Ask AI session:', err);
          notify({ message: 'Failed to start AI session', kind: 'error' });
          return;
        }
        // If user switched tabs before callback fired, clean up the orphan session
        if (noteIdRef.current !== noteIdAtCall) {
          Meteor.call('claudeSessions.remove', newSessionId);
          return;
        }
        setAskAiSessionId(newSessionId);
      });
    }
  }, [askAiSessionId]);

  const handleCloseAskAi = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) {
      view.dispatch(view.state.tr.setMeta(askAiKey, null));
    }
    setAskAiSessionId(null);
  }, []);

  const getNoteContent = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return resolveContent();
    return serializeMarkdown(view.state.doc);
  }, [noteId]);

  const getSelectedText = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return '';
    const tracked = askAiKey.getState(view.state);
    if (tracked) {
      return view.state.doc.textBetween(tracked.from, tracked.to, '\n');
    }
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
    const newDoc = parseMarkdown(text);
    const fragment = newDoc.content;
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
    const paragraphs = text.trim().split(/\n{2,}/);
    const italicText = paragraphs.map(p => `*${p.trim()}*`).join('\n\n');
    const wrappedMd = `---\n\n${italicText}\n\n---`;
    const newDoc = parseMarkdown(wrappedMd);
    const fragment = newDoc.content;
    const tr = view.state.tr.insert(insertPos, fragment);
    view.dispatch(tr);
  }, []);

  // --- Effects ---

  // Update undo availability when noteId changes
  useEffect(() => {
    setUndoAvailable(hasUndoData());
  }, [noteId]);

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

  // Cleanup Ask AI session when noteId changes (tab switch)
  useEffect(() => {
    return () => {
      if (askAiSessionIdRef.current) {
        Meteor.call('claudeSessions.remove', askAiSessionIdRef.current);
        setAskAiSessionId(null);
      }
    };
  }, [noteId]);

  return {
    // State
    isCleaning,
    isSummarizing,
    undoAvailable,
    showCleanModal,
    askAiSessionId,
    // Actions
    handleCleanNote,
    handleCleanConfirm,
    handleSummarizeNote,
    handleUndo,
    // Ask AI
    handleAskAI,
    handleCloseAskAi,
    setShowCleanModal,
    // AskAiSidebar props
    getNoteContent,
    getSelectedText,
    handleReplace,
    handleInsertBelow,
  };
}
