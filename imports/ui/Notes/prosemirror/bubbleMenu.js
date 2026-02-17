import { Plugin, PluginKey } from 'prosemirror-state';
import { toggleMark, setBlockType, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
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
      let pickerOpen = false; // Track if color picker is open
      const onMouseDown = () => { mouseDown = true; };
      const onMouseUp = () => { mouseDown = false; if (!pickerOpen) updateTooltip(editorView); };
      editorView.dom.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);

      function buildButtons() {
        tooltip.innerHTML = '';
        const { state, dispatch: _dispatch } = editorView;
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
            const selectedText = state.doc.textBetween(from, to).trim();
            const defaultUrl = /^https?:\/\/\S+$/.test(selectedText) ? selectedText : '';
            promptUrl(defaultUrl).then((href) => {
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

        // Separator before highlight/clear
        const sep3 = document.createElement('div');
        sep3.className = 'bubble-menu-sep';
        tooltip.appendChild(sep3);

        // Highlight button with color picker
        const highlightContainer = document.createElement('div');
        highlightContainer.className = 'bubble-menu-highlight-container';

        const highlightBtn = document.createElement('button');
        highlightBtn.className = 'bubble-menu-btn bubble-menu-highlight-btn';
        highlightBtn.title = 'Highlight';

        // Check if highlight is active and get current color
        const highlightMark = schema.marks.highlight;
        let currentHighlightColor = null;
        state.doc.nodesBetween(from, to, (node) => {
          if (node.marks) {
            node.marks.forEach((mark) => {
              if (mark.type === highlightMark) {
                currentHighlightColor = mark.attrs.color;
              }
            });
          }
        });

        const highlightIcon = document.createElement('span');
        highlightIcon.className = 'bubble-menu-highlight-icon';
        if (currentHighlightColor) {
          highlightIcon.style.background = `var(--highlight-${currentHighlightColor})`;
          highlightBtn.classList.add('active');
        }
        highlightBtn.appendChild(highlightIcon);

        const highlightArrow = document.createElement('span');
        highlightArrow.className = 'bubble-menu-highlight-arrow';
        highlightArrow.textContent = '▼';
        highlightBtn.appendChild(highlightArrow);

        let pickerVisible = false;
        let picker = null;

        const showPicker = () => {
          if (picker) return;
          pickerVisible = true;
          pickerOpen = true;

          picker = document.createElement('div');
          picker.className = 'bubble-menu-color-picker';

          const colors = ['yellow', 'green', 'blue', 'pink', 'orange', 'none'];
          colors.forEach((color) => {
            const colorBtn = document.createElement('button');
            colorBtn.className = `bubble-menu-color-btn color-${color}`;
            colorBtn.title = color === 'none' ? 'Remove highlight' : color.charAt(0).toUpperCase() + color.slice(1);
            if (color === currentHighlightColor) colorBtn.classList.add('active');

            colorBtn.onmousedown = (e) => {
              e.preventDefault();
              e.stopPropagation();

              if (color === 'none') {
                // Remove highlight mark
                editorView.dispatch(state.tr.removeMark(from, to, highlightMark));
              } else {
                // Apply highlight with selected color
                const mark = highlightMark.create({ color });
                editorView.dispatch(state.tr.addMark(from, to, mark));
              }

              editorView.focus();
              hidePicker();
              updateTooltip(editorView);
            };

            picker.appendChild(colorBtn);
          });

          highlightContainer.appendChild(picker);

          // Close picker when clicking outside
          const closeOnClickOutside = (e) => {
            if (!highlightContainer.contains(e.target)) {
              hidePicker();
              document.removeEventListener('mousedown', closeOnClickOutside);
            }
          };
          setTimeout(() => document.addEventListener('mousedown', closeOnClickOutside), 0);
        };

        const hidePicker = () => {
          if (picker) {
            picker.remove();
            picker = null;
            pickerVisible = false;
            pickerOpen = false;
          }
        };

        highlightBtn.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pickerVisible) {
            hidePicker();
          } else {
            showPicker();
          }
        };

        highlightContainer.appendChild(highlightBtn);
        tooltip.appendChild(highlightContainer);

        // Text color button with color picker
        const textColorContainer = document.createElement('div');
        textColorContainer.className = 'bubble-menu-textcolor-container';

        const textColorBtn = document.createElement('button');
        textColorBtn.className = 'bubble-menu-btn bubble-menu-textcolor-btn';
        textColorBtn.title = 'Text color';

        // Check if textColor is active and get current color
        const textColorMark = schema.marks.textColor;
        let currentTextColor = null;
        state.doc.nodesBetween(from, to, (node) => {
          if (node.marks) {
            node.marks.forEach((mark) => {
              if (mark.type === textColorMark) {
                currentTextColor = mark.attrs.color;
              }
            });
          }
        });

        const textColorIcon = document.createElement('span');
        textColorIcon.className = 'bubble-menu-textcolor-icon';
        textColorIcon.textContent = 'A';
        if (currentTextColor) {
          textColorIcon.style.color = `var(--text-color-${currentTextColor})`;
          textColorBtn.classList.add('active');
        }
        textColorBtn.appendChild(textColorIcon);

        const textColorArrow = document.createElement('span');
        textColorArrow.className = 'bubble-menu-textcolor-arrow';
        textColorArrow.textContent = '▼';
        textColorBtn.appendChild(textColorArrow);

        let tcPickerVisible = false;
        let tcPicker = null;

        const showTextColorPicker = () => {
          if (tcPicker) return;
          tcPickerVisible = true;
          pickerOpen = true;

          tcPicker = document.createElement('div');
          tcPicker.className = 'bubble-menu-color-picker';

          const tcColors = ['red', 'green', 'blue', 'purple', 'orange', 'none'];
          tcColors.forEach((color) => {
            const colorBtn = document.createElement('button');
            colorBtn.className = `bubble-menu-color-btn textcolor-${color}`;
            colorBtn.title = color === 'none' ? 'Remove text color' : color.charAt(0).toUpperCase() + color.slice(1);
            if (color === currentTextColor) colorBtn.classList.add('active');

            colorBtn.onmousedown = (e) => {
              e.preventDefault();
              e.stopPropagation();

              if (color === 'none') {
                // Remove textColor mark
                editorView.dispatch(state.tr.removeMark(from, to, textColorMark));
              } else {
                // Apply textColor with selected color
                const mark = textColorMark.create({ color });
                editorView.dispatch(state.tr.addMark(from, to, mark));
              }

              editorView.focus();
              hideTextColorPicker();
              updateTooltip(editorView);
            };

            tcPicker.appendChild(colorBtn);
          });

          textColorContainer.appendChild(tcPicker);

          // Close picker when clicking outside
          const closeOnClickOutside = (e) => {
            if (!textColorContainer.contains(e.target)) {
              hideTextColorPicker();
              document.removeEventListener('mousedown', closeOnClickOutside);
            }
          };
          setTimeout(() => document.addEventListener('mousedown', closeOnClickOutside), 0);
        };

        const hideTextColorPicker = () => {
          if (tcPicker) {
            tcPicker.remove();
            tcPicker = null;
            tcPickerVisible = false;
            pickerOpen = false;
          }
        };

        textColorBtn.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (tcPickerVisible) {
            hideTextColorPicker();
          } else {
            showTextColorPicker();
          }
        };

        textColorContainer.appendChild(textColorBtn);
        tooltip.appendChild(textColorContainer);

        // Clear formatting button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'bubble-menu-btn bubble-menu-btn-clear';
        clearBtn.innerHTML = 'T&#x338;'; // T with strikethrough
        clearBtn.title = 'Clear all formatting';
        clearBtn.onmousedown = (e) => {
          e.preventDefault();

          const { $from, empty } = state.selection;

          // If no selection, work on the current block (line)
          let clearFrom, clearTo;
          if (empty) {
            clearFrom = $from.start();
            clearTo = $from.end();
          } else {
            clearFrom = from;
            clearTo = to;
          }

          let tr = state.tr;

          // 1. Remove all marks
          tr = tr.removeMark(clearFrom, clearTo);

          // 2. Convert headings and code blocks to paragraphs
          state.doc.nodesBetween(clearFrom, clearTo, (node, pos) => {
            if (node.type === schema.nodes.heading || node.type === schema.nodes.code_block) {
              tr = tr.setNodeMarkup(tr.mapping.map(pos), schema.nodes.paragraph);
            }
          });

          editorView.dispatch(tr);

          // 3. Lift out of lists (requires fresh state after each lift)
          let lifted = true;
          while (lifted) {
            lifted = liftListItem(schema.nodes.list_item)(editorView.state, editorView.dispatch);
          }

          // 4. Lift out of blockquotes
          let liftedBq = true;
          while (liftedBq) {
            liftedBq = lift(editorView.state, editorView.dispatch);
          }

          editorView.focus();
          updateTooltip(editorView);
        };
        tooltip.appendChild(clearBtn);

        // Separator before Ask AI
        if (onAskAI) {
          const sep4 = document.createElement('div');
          sep4.className = 'bubble-menu-sep';
          tooltip.appendChild(sep4);

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
