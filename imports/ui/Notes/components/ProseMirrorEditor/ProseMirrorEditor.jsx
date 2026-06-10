import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from '../../prosemirror/markdownIO.js';
import { createPlugins } from '../../prosemirror/plugins.js';
import { searchPluginKey } from '../../prosemirror/searchPlugin.js';
import { TaskItemView } from '../../prosemirror/taskItemView.js';
import { ToggleBlockView } from '../../prosemirror/toggleBlockView.js';
import { ImageResizeView } from '../../prosemirror/imageResizeView.js';
import { noteScrollStore } from '../../noteScrollStore.js';
import './ProseMirrorEditor.css';
import '../BubbleMenu/BubbleMenu.css';
import '../SlashMenu/SlashMenu.css';

const DEBOUNCE_MS = 150;
export const ProseMirrorEditor = forwardRef(({ content, noteId, onChange, onSave, onClose, onAskAI, onSearchInfo, searchTerm, shouldFocus, readOnly = false }, ref) => {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const debounceRef = useRef(null);
  // Synchronously serialize any pending (debounced) change — set in the mount effect
  const flushRef = useRef(null);
  const shouldFocusOnMount = useRef(shouldFocus);
  const readOnlyRef = useRef(readOnly);
  // Scroll restoration state — see init effect for the retry logic
  const scrollRestoredRef = useRef(false);
  const tryRestoreScrollRef = useRef(null);
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
    flush() { flushRef.current?.(); },
  }), []);

  // Create the editor once on mount
  useEffect(() => {
    if (!mountRef.current) return;

    const doc = parseMarkdown(content || '');
    const plugins = createPlugins({
      // Flush the pending debounced serialization before save/close so the
      // parent acts on the latest keystrokes, not a 150ms-stale snapshot
      onSave: () => { flushRef.current?.(); onSaveRef.current?.(); },
      onClose: () => { flushRef.current?.(); onCloseRef.current?.(); },
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
        image: (node, view, getPos) => new ImageResizeView(node, view, getPos),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        if (tr.docChanged) {
          // Debounce markdown serialization
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            const md = serializeMarkdown(newState.doc);
            lastKnownContentRef.current = md;
            onChangeRef.current?.(md);
          }, DEBOUNCE_MS);
        }
      },
    });

    viewRef.current = view;

    // Serialize a pending debounced change right now (save, close, unmount)
    const flushPending = () => {
      if (!debounceRef.current) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      const md = serializeMarkdown(view.state.doc);
      if (md === lastKnownContentRef.current) return;
      lastKnownContentRef.current = md;
      onChangeRef.current?.(md);
    };
    flushRef.current = flushPending;

    // Restore scroll position for this note. The doc may not be laid out yet
    // when the editor mounts (content prop can arrive a tick later), so we
    // retry on the next animation frame and again on each content sync until
    // the scroll container is actually tall enough to honor the target.
    const scrollEl = mountRef.current;
    const tryRestoreScroll = () => {
      if (scrollRestoredRef.current) return true;
      const target = noteScrollStore.get(noteId);
      if (target <= 0) { scrollRestoredRef.current = true; return true; }
      if (scrollEl.scrollHeight <= scrollEl.clientHeight + 1) return false;
      scrollEl.scrollTop = target;
      scrollRestoredRef.current = true;
      return true;
    };
    tryRestoreScrollRef.current = tryRestoreScroll;
    // First attempt after layout for the initial doc has run
    requestAnimationFrame(tryRestoreScroll);

    // Persist scroll position as the user scrolls (only after restore — earlier
    // scroll events come from layout, not the user, and would overwrite the
    // saved position with 0).
    const onScroll = () => {
      if (!scrollRestoredRef.current) return;
      // Ignore scroll events triggered by layout teardown (flex parent collapsing
      // when the user switches tab) — they fire with scrollTop=0 and would
      // overwrite the legitimate saved position. A real scroll always implies
      // the container still has scrollable content.
      if (scrollEl.scrollHeight <= scrollEl.clientHeight + 1) return;
      noteScrollStore.set(noteId, scrollEl.scrollTop);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    // Focus immediately at mount — no timeout, no race condition
    if (shouldFocusOnMount.current) {
      view.focus();
    }

    return () => {
      // We do NOT save scroll position on unmount: the scroll handler has already
      // captured the latest user-driven value, and reading scrollTop at unmount
      // can return 0 if the layout has collapsed (flex parent change on tab switch).
      scrollEl.removeEventListener('scroll', onScroll);
      tryRestoreScrollRef.current = null;
      // Flush instead of dropping: switching tabs (remount via key) within the
      // debounce window must not lose the last keystrokes
      flushPending();
      flushRef.current = null;
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
    // Content just landed — retry scroll restore on the next frame once the
    // new doc has been laid out.
    if (!scrollRestoredRef.current && tryRestoreScrollRef.current) {
      requestAnimationFrame(() => tryRestoreScrollRef.current?.());
    }
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
  noteId: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onSave: PropTypes.func,
  onClose: PropTypes.func,
  onAskAI: PropTypes.func,
  onSearchInfo: PropTypes.func,
  searchTerm: PropTypes.string,
  shouldFocus: PropTypes.bool,
  readOnly: PropTypes.bool,
};
