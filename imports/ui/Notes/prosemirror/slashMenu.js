import { Plugin, PluginKey } from 'prosemirror-state';
import { setBlockType, wrapIn } from 'prosemirror-commands';
import { schema } from './schema.js';

export const slashMenuKey = new PluginKey('slashMenu');

const COMMANDS = [
  { label: 'Heading 1', keyword: 'h1', action: (view) => setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch) },
  { label: 'Heading 2', keyword: 'h2', action: (view) => setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch) },
  { label: 'Heading 3', keyword: 'h3', action: (view) => setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch) },
  { label: 'Code Block', keyword: 'code', action: (view) => setBlockType(schema.nodes.code_block)(view.state, view.dispatch) },
  { label: 'Blockquote', keyword: 'quote', action: (view) => wrapIn(schema.nodes.blockquote)(view.state, view.dispatch) },
  {
    label: 'Horizontal Rule', keyword: 'hr', action: (view) => {
      const { state, dispatch } = view;
      dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView());
      return true;
    },
  },
];

/**
 * SlashMenu plugin: detects `/` at the start of a paragraph
 * and shows a command palette.
 */
export function slashMenuPlugin() {
  let tooltip = null;
  let selectedIndex = 0;
  let filteredCommands = COMMANDS;
  let active = false;
  let slashFrom = -1;

  function getQuery(state) {
    const { $from } = state.selection;
    if (!$from.parent.isTextblock) return null;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc').replace(/\u200B/g, '');
    const match = /^\/([\w]*)$/.exec(textBefore);
    return match ? match[1] : null;
  }

  function hide() {
    if (tooltip) tooltip.style.display = 'none';
    active = false;
    selectedIndex = 0;
  }

  function renderMenu() {
    if (!tooltip) return;
    tooltip.innerHTML = '';
    filteredCommands.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = `slash-menu-item${i === selectedIndex ? ' selected' : ''}`;
      item.textContent = cmd.label;
      item.onmousedown = (e) => {
        e.preventDefault();
        executeCommand(i);
      };
      item.onmouseenter = () => {
        selectedIndex = i;
        renderMenu();
      };
      tooltip.appendChild(item);
    });
  }

  let _currentView = null;

  function executeCommand(index) {
    const view = _currentView;
    const cmd = filteredCommands[index];
    if (!view || !cmd) return;

    // Calculate the exact range of /query from cursor position
    const { state } = view;
    const { $from } = state.selection;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const deleteFrom = $from.pos - textBefore.length;
    const deleteTo = $from.pos;

    // Delete the /query text
    view.dispatch(state.tr.delete(deleteFrom, deleteTo));

    // Apply the command on the updated state
    cmd.action(view);
    view.focus();
    hide();
  }

  return new Plugin({
    key: slashMenuKey,

    props: {
      handleKeyDown(view, event) {
        if (!active) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          selectedIndex = (selectedIndex + 1) % filteredCommands.length;
          renderMenu();
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
          renderMenu();
          return true;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          executeCommand(selectedIndex);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          hide();
          return true;
        }
        return false;
      },
    },

    view(editorView) {
      tooltip = document.createElement('div');
      tooltip.className = 'slash-menu';
      tooltip.style.display = 'none';
      document.body.appendChild(tooltip);
      _currentView = editorView;

      return {
        update(view) {
          _currentView = view;
          const { state } = view;
          const query = getQuery(state);

          if (query === null) {
            hide();
            return;
          }

          // Filter commands by query
          const lowerQuery = query.toLowerCase();
          filteredCommands = COMMANDS.filter(
            (cmd) => cmd.keyword.includes(lowerQuery) || cmd.label.toLowerCase().includes(lowerQuery),
          );

          if (filteredCommands.length === 0) {
            hide();
            return;
          }

          active = true;
          selectedIndex = Math.min(selectedIndex, filteredCommands.length - 1);

          // Position below the cursor
          const { $from } = state.selection;
          const coords = view.coordsAtPos($from.pos);
          tooltip.style.display = 'block';
          renderMenu();

          const tooltipRect = tooltip.getBoundingClientRect();
          tooltip.style.left = `${coords.left}px`;
          tooltip.style.top = `${coords.bottom + 4}px`;
        },
        destroy() {
          tooltip.remove();
          tooltip = null;
          _currentView = null;
        },
      };
    },
  });
}
