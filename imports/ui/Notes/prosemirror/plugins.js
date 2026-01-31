import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { Plugin } from 'prosemirror-state';
import { createAppKeymap, createFormattingKeymap, createBaseKeymap } from './keymap.js';
import { createInputRules } from './inputRules.js';
import { bubbleMenuPlugin } from './bubbleMenu.js';
import { slashMenuPlugin } from './slashMenu.js';
import { askAiPlugin } from './askAiPlugin.js';

// Placeholder plugin: toggles a CSS class on the editor DOM when the doc is empty.
// The actual placeholder text is rendered via CSS ::before pseudo-element,
// which avoids widget decorations that interfere with the browser caret.
function isDocEmpty(doc) {
  return doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0;
}

function placeholderPlugin() {
  return new Plugin({
    view(editorView) {
      const update = (view) => {
        view.dom.classList.toggle('pm-empty', isDocEmpty(view.state.doc));
      };
      update(editorView);
      return { update };
    },
  });
}

/**
 * Create the full plugin array for the ProseMirror editor.
 * @param {{ onSave: () => void, onClose: () => void }} opts
 * @returns {Plugin[]}
 */
export function createPlugins({ onSave, onClose, onAskAI }) {
  return [
    slashMenuPlugin(),              // First: intercepts Enter/Arrows/Escape when menu is active
    createAppKeymap({ onSave, onClose }),
    createFormattingKeymap(),
    createInputRules(),
    createBaseKeymap(),
    history(),
    dropCursor(),
    gapCursor(),
    placeholderPlugin(),
    askAiPlugin(),
    bubbleMenuPlugin({ onAskAI }),
  ];
}
