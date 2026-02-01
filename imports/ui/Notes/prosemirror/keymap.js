import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, lift, chainCommands } from 'prosemirror-commands';
import { sinkListItem, liftListItem, splitListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';

/**
 * Create the app-level keymap (Cmd+S, Cmd+W).
 */
export function createAppKeymap({ onSave, onClose }) {
  return keymap({
    'Mod-s': (_state, _dispatch, view) => {
      onSave?.();
      return true;
    },
    'Mod-w': (_state, _dispatch, view) => {
      onClose?.();
      return true;
    },
  });
}

/**
 * Create the formatting keymap (bold, italic, code, link, lists).
 */
export function createFormattingKeymap() {
  const { strong, em, code, link } = schema.marks;

  return keymap({
    'Mod-b': toggleMark(strong),
    'Mod-i': toggleMark(em),
    'Mod-e': toggleMark(code),
    'Mod-k': (state, dispatch, view) => {
      if (state.selection.empty) return false;
      const hasLink = state.doc.rangeHasMark(state.selection.from, state.selection.to, link);
      if (hasLink) {
        // Remove the link
        if (dispatch) dispatch(state.tr.removeMark(state.selection.from, state.selection.to, link));
        return true;
      }
      const href = prompt('Enter URL:');
      if (!href) return true;
      if (dispatch) {
        const mark = link.create({ href });
        dispatch(state.tr.addMark(state.selection.from, state.selection.to, mark));
      }
      return true;
    },
    'Tab': (state, dispatch) => {
      // In a list: indent the list item
      if (sinkListItem(schema.nodes.list_item)(state, dispatch)) return true;
      // Otherwise: insert a tab character at cursor
      if (dispatch) dispatch(state.tr.insertText('\t'));
      return true;
    },
    'Shift-Tab': (state, dispatch) => {
      // In a list: outdent the list item
      if (liftListItem(schema.nodes.list_item)(state, dispatch)) return true;
      // Outside list: just consume the event (don't leave editor)
      return true;
    },
    'Enter': (state, dispatch) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === schema.nodes.list_item) {
          if ($from.node(d).attrs.checked !== null) {
            return splitListItem(schema.nodes.list_item, { checked: false })(state, dispatch);
          }
          break;
        }
      }
      return splitListItem(schema.nodes.list_item)(state, dispatch);
    },
  });
}

/**
 * Create the base editing keymap with undo/redo.
 */
export function createBaseKeymap() {
  return keymap({
    ...baseKeymap,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  });
}
