import { Plugin, PluginKey } from 'prosemirror-state';
import { toggleMark, setBlockType } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { schema } from './schema.js';
import { promptUrl } from './promptUrl.js';

export const bubbleMenuKey = new PluginKey('bubbleMenu');

/**
 * Creates a bubble menu plugin that shows formatting options on text selection.
 * Renders a floating toolbar positioned above the selection.
 */
export function bubbleMenuPlugin({ onAskAI } = {}) {
  let tooltip = null;

  return new Plugin({
    key: bubbleMenuKey,

    view(editorView) {
      tooltip = document.createElement('div');
      tooltip.className = 'bubble-menu';
      tooltip.style.display = 'none';
      document.body.appendChild(tooltip);

      let mouseDown = false;
      const onMouseDown = () => { mouseDown = true; };
      const onMouseUp = () => { mouseDown = false; updateTooltip(editorView); };
      editorView.dom.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);

      function buildButtons() {
        tooltip.innerHTML = '';
        const { state, dispatch } = editorView;
        const { from, to } = state.selection;

        const buttons = [
          { label: 'B', mark: 'strong', title: 'Bold (Cmd+B)' },
          { label: 'I', mark: 'em', title: 'Italic (Cmd+I)' },
          { label: '<>', mark: 'code', title: 'Code (Cmd+E)' },
        ];

        buttons.forEach(({ label, mark, title }) => {
          const btn = document.createElement('button');
          btn.className = 'bubble-menu-btn';
          btn.textContent = label;
          btn.title = title;

          // Highlight if mark is active
          const markType = schema.marks[mark];
          if (state.doc.rangeHasMark(from, to, markType)) {
            btn.classList.add('active');
          }

          btn.onmousedown = (e) => {
            e.preventDefault(); // Keep editor focus
            toggleMark(markType)(editorView.state, editorView.dispatch);
            editorView.focus();
            updateTooltip(editorView);
          };
          tooltip.appendChild(btn);
        });

        // Link button
        const linkBtn = document.createElement('button');
        linkBtn.className = 'bubble-menu-btn';
        linkBtn.textContent = 'Link';
        linkBtn.title = 'Link (Cmd+K)';
        const hasLink = state.doc.rangeHasMark(from, to, schema.marks.link);
        if (hasLink) linkBtn.classList.add('active');

        linkBtn.onmousedown = (e) => {
          e.preventDefault();
          if (hasLink) {
            editorView.dispatch(state.tr.removeMark(from, to, schema.marks.link));
            editorView.focus();
            updateTooltip(editorView);
          } else {
            promptUrl().then((href) => {
              if (href) {
                const mark = schema.marks.link.create({ href });
                const currentState = editorView.state;
                editorView.dispatch(currentState.tr.addMark(from, to, mark));
              }
              editorView.focus();
              updateTooltip(editorView);
            });
          }
        };
        tooltip.appendChild(linkBtn);

        // Separator
        const sep = document.createElement('div');
        sep.className = 'bubble-menu-sep';
        tooltip.appendChild(sep);

        // Heading buttons
        const { $from } = state.selection;
        const parentNode = $from.parent;
        const isHeading = parentNode.type === schema.nodes.heading;
        const currentLevel = isHeading ? parentNode.attrs.level : 0;

        [1, 2, 3].forEach((level) => {
          const btn = document.createElement('button');
          btn.className = 'bubble-menu-btn';
          btn.textContent = `H${level}`;
          btn.title = `Heading ${level}`;
          if (currentLevel === level) btn.classList.add('active');

          btn.onmousedown = (e) => {
            e.preventDefault();
            if (currentLevel === level) {
              // Toggle off: revert to paragraph
              setBlockType(schema.nodes.paragraph)(editorView.state, editorView.dispatch);
            } else {
              setBlockType(schema.nodes.heading, { level })(editorView.state, editorView.dispatch);
            }
            editorView.focus();
            updateTooltip(editorView);
          };
          tooltip.appendChild(btn);
        });

        // Separator + Todo button
        const sep2 = document.createElement('div');
        sep2.className = 'bubble-menu-sep';
        tooltip.appendChild(sep2);

        // Check if all list_items in selection are already tasks
        const items = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type === schema.nodes.list_item) {
            items.push({ node, pos });
            return false;
          }
        });
        const allTasks = items.length > 0 && items.every(i => i.node.attrs.checked !== null);

        const todoBtn = document.createElement('button');
        todoBtn.className = 'bubble-menu-btn';
        todoBtn.textContent = 'Todo';
        todoBtn.title = 'Convert to task list';
        if (allTasks) todoBtn.classList.add('active');

        todoBtn.onmousedown = (e) => {
          e.preventDefault();

          if (allTasks) {
            // Toggle off: remove checked from all list_items
            let tr = editorView.state.tr;
            items.forEach(({ node, pos }) => {
              tr = tr.setNodeMarkup(tr.mapping.map(pos), null, { ...node.attrs, checked: null });
            });
            editorView.dispatch(tr);
          } else if (items.length > 0) {
            // Already in list items: set checked on those that aren't tasks
            let tr = editorView.state.tr;
            items.forEach(({ node, pos }) => {
              if (node.attrs.checked === null) {
                tr = tr.setNodeMarkup(tr.mapping.map(pos), null, { ...node.attrs, checked: false });
              }
            });
            editorView.dispatch(tr);
          } else {
            // Not in a list: wrap in bullet_list then set checked
            if (wrapInList(schema.nodes.bullet_list)(editorView.state, editorView.dispatch)) {
              const ns = editorView.state;
              const { from: nf, to: nt } = ns.selection;
              let tr = ns.tr;
              ns.doc.nodesBetween(nf, nt, (node, pos) => {
                if (node.type === schema.nodes.list_item) {
                  tr = tr.setNodeMarkup(tr.mapping.map(pos), null, { ...node.attrs, checked: false });
                  return false;
                }
              });
              if (tr.docChanged) editorView.dispatch(tr);
            }
          }
          editorView.focus();
          updateTooltip(editorView);
        };
        tooltip.appendChild(todoBtn);

        // Separator before Ask AI
        if (onAskAI) {
          const sep2 = document.createElement('div');
          sep2.className = 'bubble-menu-sep';
          tooltip.appendChild(sep2);

          const aiBtn = document.createElement('button');
          aiBtn.className = 'bubble-menu-btn bubble-menu-btn-ai';
          aiBtn.textContent = 'Ask AI';
          aiBtn.title = 'Ask AI about selection';
          aiBtn.onmousedown = (e) => {
            e.preventDefault();
            const sel = editorView.state.selection;
            const selectedText = editorView.state.doc.textBetween(sel.from, sel.to, '\n');
            onAskAI({ from: sel.from, to: sel.to, selectedText });
          };
          tooltip.appendChild(aiBtn);
        }
      }

      function updateTooltip(view) {
        if (!tooltip) return;
        const { state } = view;
        const { from, to, empty } = state.selection;

        if (empty || mouseDown) {
          tooltip.style.display = 'none';
          return;
        }

        // Position the tooltip above the selection
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        const centerX = (start.left + end.left) / 2;

        buildButtons();
        tooltip.style.display = 'flex';

        // Measure tooltip to center it
        const tooltipRect = tooltip.getBoundingClientRect();
        const left = centerX - tooltipRect.width / 2;
        const top = start.top - tooltipRect.height - 8;

        tooltip.style.left = `${Math.max(8, left)}px`;
        tooltip.style.top = `${Math.max(8, top)}px`;
      }

      // Initial update
      updateTooltip(editorView);

      return {
        update(view) {
          updateTooltip(view);
        },
        destroy() {
          editorView.dom.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mouseup', onMouseUp);
          tooltip.remove();
          tooltip = null;
        },
      };
    },
  });
}
