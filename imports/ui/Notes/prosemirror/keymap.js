import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, lift, chainCommands } from 'prosemirror-commands';
import { sinkListItem, liftListItem, splitListItem } from 'prosemirror-schema-list';
import { TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { promptUrl } from './promptUrl.js';

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
      const { from, to } = state.selection;
      const hasLink = state.doc.rangeHasMark(from, to, link);
      if (hasLink) {
        if (dispatch) dispatch(state.tr.removeMark(from, to, link));
        return true;
      }
      if (view) {
        const selectedText = state.doc.textBetween(from, to).trim();
        const defaultUrl = /^https?:\/\/\S+$/.test(selectedText) ? selectedText : '';
        promptUrl(defaultUrl).then((href) => {
          if (href) {
            const mark = link.create({ href });
            const currentState = view.state;
            view.dispatch(currentState.tr.addMark(from, to, mark));
          }
          view.focus();
        });
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
    'Mod-ArrowUp': (state, dispatch) => {
      const { $from } = state.selection;
      let depth = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === schema.nodes.list_item) {
          depth = d;
          break;
        }
      }
      if (depth === null) return false;
      const listItem = $from.node(depth);
      const index = $from.index(depth - 1);
      if (index === 0) return true; // First item, can't move up - consume event
      const parentNode = $from.node(depth - 1);
      const prevNode = parentNode.child(index - 1);
      const curNode = listItem;
      const itemStart = $from.before(depth);
      const itemEnd = $from.after(depth);
      const prevStart = itemStart - prevNode.nodeSize;
      if (dispatch) {
        const tr = state.tr.replaceWith(prevStart, itemEnd, Fragment.from([curNode, prevNode]));
        const newCursorPos = prevStart + ($from.pos - itemStart);
        tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
        dispatch(tr.scrollIntoView());
      }
      return true;
    },
    'Mod-ArrowDown': (state, dispatch) => {
      const { $from } = state.selection;
      let depth = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === schema.nodes.list_item) {
          depth = d;
          break;
        }
      }
      if (depth === null) return false;
      const listItem = $from.node(depth);
      const parentNode = $from.node(depth - 1);
      const index = $from.index(depth - 1);
      if (index >= parentNode.childCount - 1) return true; // Last item, can't move down - consume event
      const nextNode = parentNode.child(index + 1);
      const curNode = listItem;
      const itemStart = $from.before(depth);
      const itemEnd = $from.after(depth);
      const nextEnd = itemEnd + nextNode.nodeSize;
      if (dispatch) {
        const tr = state.tr.replaceWith(itemStart, nextEnd, Fragment.from([nextNode, curNode]));
        const newCursorPos = itemStart + nextNode.nodeSize + ($from.pos - itemStart);
        tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
        dispatch(tr.scrollIntoView());
      }
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
    'Backspace': (state, dispatch) => {
      const { $from, empty } = state.selection;

      // Only handle when cursor is at start (no selection)
      if (!empty) return false;

      // Must be at the start of the parent block
      if ($from.parentOffset !== 0) return false;

      // Check if we're in a list_item
      let listItemDepth = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === schema.nodes.list_item) {
          listItemDepth = d;
          break;
        }
      }

      if (listItemDepth !== null) {
        // We're in a list_item - check if we're in the first block
        if ($from.index(listItemDepth) !== 0) return false;
        // Lift it out
        return liftListItem(schema.nodes.list_item)(state, dispatch);
      }

      // Not in a list - check if previous sibling is a list
      // If we're in an empty paragraph after a list, delete the paragraph
      // and move cursor to end of the list
      const parent = $from.node($from.depth - 1);
      const indexInParent = $from.index($from.depth - 1);

      if (indexInParent > 0) {
        const prevSibling = parent.child(indexInParent - 1);
        const isList = prevSibling.type === schema.nodes.bullet_list ||
                       prevSibling.type === schema.nodes.ordered_list;
        const currentNode = $from.parent;
        const isEmptyParagraph = currentNode.type === schema.nodes.paragraph &&
                                  currentNode.content.size === 0;

        if (isList && isEmptyParagraph && dispatch) {
          // Delete the empty paragraph and position cursor at end of list
          const paragraphStart = $from.before($from.depth);
          const paragraphEnd = $from.after($from.depth);

          // Find the end position of the last item in the list
          const lastListItem = prevSibling.lastChild;
          const endOfList = paragraphStart - 1; // Just before the paragraph = end of list

          const tr = state.tr.delete(paragraphStart, paragraphEnd);
          // Position cursor at the end of the list's last item's content
          tr.setSelection(TextSelection.create(tr.doc, endOfList - 1));
          dispatch(tr.scrollIntoView());
          return true;
        }
      }

      return false;
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
