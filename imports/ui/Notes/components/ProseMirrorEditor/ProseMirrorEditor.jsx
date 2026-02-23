import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from '../../prosemirror/markdownIO.js';
import { createPlugins } from '../../prosemirror/plugins.js';
import { searchPluginKey } from '../../prosemirror/searchPlugin.js';
import { TaskItemView } from '../../prosemirror/taskItemView.js';
import { ToggleBlockView } from '../../prosemirror/toggleBlockView.js';
import './ProseMirrorEditor.css';
import '../BubbleMenu/BubbleMenu.css';
import '../SlashMenu/SlashMenu.css';

const DEBOUNCE_MS = 150;
export const ProseMirrorEditor = forwardRef(({ content, onChange, onSave, onClose, onAskAI, onSearchInfo, searchTerm, shouldFocus, readOnly = false }, ref) => {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const debounceRef = useRef(null);
  const shouldFocusOnMount = useRef(shouldFocus);
  const readOnlyRef = useRef(readOnly);
  // Track last content known to the editor (set on mount + after each onChange)
  // to distinguish external prop updates from user-edit-driven prop updates
  const lastKnownContentRef = useRef(content);
  // Store callbacks in refs to avoid recreating the editor on callback changes
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const onAskAIRef = useRef(onAskAI);
  const onSearchInfoRef = useRef(onSearchInfo);

  // Keep refs in sync
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onAskAIRef.current = onAskAI; }, [onAskAI]);
  useEffect(() => { onSearchInfoRef.current = onSearchInfo; }, [onSearchInfo]);

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
    searchNext() {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.tr.setMeta(searchPluginKey, { navigate: 'next' }));
    },
    searchPrev() {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.tr.setMeta(searchPluginKey, { navigate: 'prev' }));
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
      onSearchInfo: (count, idx) => onSearchInfoRef.current?.(count, idx),
    });

    const state = EditorState.create({ doc, plugins });

    const view = new EditorView(mountRef.current, {
      state,
      editable: () => !readOnlyRef.current,
      nodeViews: {
        list_item: (node, view, getPos) => new TaskItemView(node, view, getPos),
        toggle_block: (node, view, getPos) => new ToggleBlockView(node, view, getPos),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        if (tr.docChanged) {
          // Debounce markdown serialization
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const md = serializeMarkdown(newState.doc);
            lastKnownContentRef.current = md;
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
    // Only run on mount — tab switches trigger remount via key={activeTabId}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external content changes (e.g. DB update arriving after mount via draft invalidation)
  useEffect(() => {
    if (content === lastKnownContentRef.current) return;
    lastKnownContentRef.current = content;
    const view = viewRef.current;
    if (!view) return;
    const doc = parseMarkdown(content || '');
    const state = EditorState.create({ doc, plugins: view.state.plugins });
    view.updateState(state);
  }, [content]);

  // Update editable state dynamically when readOnly prop changes
  useEffect(() => {
    readOnlyRef.current = readOnly;
    viewRef.current?.setProps({ editable: () => !readOnly });
  }, [readOnly]);

  // Dispatch search query to plugin when searchTerm changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const query = searchTerm && searchTerm.length >= 3 ? searchTerm : '';
    view.dispatch(view.state.tr.setMeta(searchPluginKey, { query }));
  }, [searchTerm]);

  return <div ref={mountRef} className={`prosemirror-editor${readOnly ? ' readonly' : ''}`} />;
});

ProseMirrorEditor.displayName = 'ProseMirrorEditor';

ProseMirrorEditor.propTypes = {
  content: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onSave: PropTypes.func,
  onClose: PropTypes.func,
  onAskAI: PropTypes.func,
  onSearchInfo: PropTypes.func,
  searchTerm: PropTypes.string,
  shouldFocus: PropTypes.bool,
  readOnly: PropTypes.bool,
};
