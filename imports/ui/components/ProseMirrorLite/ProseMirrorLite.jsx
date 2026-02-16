import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from '../../Notes/prosemirror/markdownIO.js';
import { createLitePlugins } from '../../Notes/prosemirror/plugins.js';
import { TaskItemView } from '../../Notes/prosemirror/taskItemView.js';
// Reuse content styles (headings, lists, code blocks, etc.) from the full editor
import '../../Notes/components/ProseMirrorEditor/ProseMirrorEditor.css';
import './ProseMirrorLite.css';

const DEBOUNCE_MS = 400;

export const ProseMirrorLite = ({ content, onChange }) => {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const debounceRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!mountRef.current) return;

    const doc = parseMarkdown(content || '');
    const plugins = createLitePlugins();
    const state = EditorState.create({ doc, plugins });

    const view = new EditorView(mountRef.current, {
      state,
      nodeViews: {
        list_item: (node, view, getPos) => new TaskItemView(node, view, getPos),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        if (tr.docChanged) {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const md = serializeMarkdown(newState.doc);
            onChangeRef.current?.(md);
          }, DEBOUNCE_MS);
        }
      },
    });

    viewRef.current = view;

    return () => {
      clearTimeout(debounceRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount — content changes trigger remount via key in parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="prosemirror-editor pm-lite" />;
};

ProseMirrorLite.propTypes = {
  content: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};
