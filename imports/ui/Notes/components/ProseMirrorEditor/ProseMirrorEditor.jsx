import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from '../../prosemirror/markdownIO.js';
import { createPlugins } from '../../prosemirror/plugins.js';
import './ProseMirrorEditor.css';
import '../BubbleMenu/BubbleMenu.css';
import '../SlashMenu/SlashMenu.css';

const DEBOUNCE_MS = 150;
export const ProseMirrorEditor = forwardRef(({ content, onChange, onSave, onClose, onAskAI, shouldFocus }, ref) => {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const debounceRef = useRef(null);
  const shouldFocusOnMount = useRef(shouldFocus);
  // Store callbacks in refs to avoid recreating the editor on callback changes
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const onAskAIRef = useRef(onAskAI);

  // Keep refs in sync
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onAskAIRef.current = onAskAI; }, [onAskAI]);

  // Expose the editor view to parent via ref
  useImperativeHandle(ref, () => ({
    get view() { return viewRef.current; },
    setContent(markdown) {
      const view = viewRef.current;
      if (!view) return;
      const doc = parseMarkdown(markdown || '');
      const state = EditorState.create({ doc, plugins: view.state.plugins });
      view.updateState(state);
    },
  }), []);

  // Create the editor once on mount
  useEffect(() => {
    if (!mountRef.current) return;

    const doc = parseMarkdown(content || '');
    const plugins = createPlugins({
      onSave: () => onSaveRef.current?.(),
      onClose: () => onCloseRef.current?.(),
      onAskAI: (data) => onAskAIRef.current?.(data),
    });

    const state = EditorState.create({ doc, plugins });

    const view = new EditorView(mountRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        if (tr.docChanged) {
          // Debounce markdown serialization
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const md = serializeMarkdown(newState.doc);
            onChangeRef.current?.(md);
          }, DEBOUNCE_MS);
        }
      },
    });

    viewRef.current = view;

    // Focus immediately at mount — no timeout, no race condition
    if (shouldFocusOnMount.current) {
      view.focus();
    }

    return () => {
      clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount — content changes trigger remount via key={activeTabId}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="prosemirror-editor" />;
});

ProseMirrorEditor.displayName = 'ProseMirrorEditor';

ProseMirrorEditor.propTypes = {
  content: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onSave: PropTypes.func,
  onClose: PropTypes.func,
  onAskAI: PropTypes.func,
  shouldFocus: PropTypes.bool,
};
