import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { Plugin } from 'prosemirror-state';
import { createAppKeymap, createFormattingKeymap, createBaseKeymap } from './keymap.js';
import { createInputRules } from './inputRules.js';
import { bubbleMenuPlugin } from './bubbleMenu.js';
import { slashMenuPlugin } from './slashMenu.js';
import { askAiPlugin } from './askAiPlugin.js';
import { createSearchPlugin } from './searchPlugin.js';

// Link click handler: Cmd/Ctrl+click opens links in a new tab.
// Shows a tooltip on hover with the URL and shortcut hint.
function linkClickPlugin() {
  let tip = null;

  function showTip(href, rect) {
    if (!tip) {
      tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;z-index:1000;pointer-events:none;background:var(--panel);color:var(--text);border:1px solid var(--border);padding:6px 10px;border-radius:6px;font-size:12px;line-height:1.4;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      document.body.appendChild(tip);
    }
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = isMac ? '\u2318' : 'Ctrl';
    tip.innerHTML = `<span style="opacity:0.7">${mod}+Click to open</span><br><span style="opacity:0.5">${href.replace(/</g, '&lt;')}</span>`;
    tip.style.display = '';
    tip.style.left = `${Math.max(8, rect.left)}px`;
    tip.style.top = `${rect.bottom + 6}px`;
  }

  function hideTip() {
    if (tip) tip.style.display = 'none';
  }

  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        if (!event.metaKey && !event.ctrlKey) return false;
        const $pos = view.state.doc.resolve(pos);
        const linkMark = $pos.marks().find(m => m.type.name === 'link');
        if (linkMark?.attrs.href) {
          window.open(linkMark.attrs.href, '_blank', 'noopener');
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        mouseover(view, event) {
          const a = event.target.closest?.('a[href]');
          if (a && view.dom.contains(a)) {
            showTip(a.getAttribute('href'), a.getBoundingClientRect());
          } else {
            hideTip();
          }
          return false;
        },
        mouseout(view, event) {
          const a = event.target.closest?.('a[href]');
          if (a) hideTip();
          return false;
        },
      },
    },
    view() {
      return {
        destroy() {
          tip?.remove();
          tip = null;
        },
      };
    },
  });
}

// Auto-join adjacent same-type lists (bullet_list or ordered_list).
// When a user deletes the paragraph between two lists of the same type,
// ProseMirror keeps them as separate nodes. The markdown serializer would
// then insert extra newlines between them, creating a phantom blank line
// that can never be deleted. This plugin merges them automatically.
function autoJoinAdjacentLists() {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some(tr => tr.docChanged)) return null;

      const { doc } = newState;
      const joins = [];
      let pos = 0;
      for (let i = 0; i < doc.childCount; i++) {
        const child = doc.child(i);
        if (i > 0) {
          const prev = doc.child(i - 1);
          if (prev.type === child.type &&
              (child.type.name === 'bullet_list' || child.type.name === 'ordered_list')) {
            joins.push(pos);
          }
        }
        pos += child.nodeSize;
      }

      if (joins.length === 0) return null;

      const tr = newState.tr;
      for (let i = joins.length - 1; i >= 0; i--) {
        tr.join(joins[i]);
      }
      return tr.docChanged ? tr : null;
    },
  });
}

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
export function createPlugins({ onSave, onClose, onAskAI, onSearchInfo }) {
  return [
    slashMenuPlugin(),              // First: intercepts Enter/Arrows/Escape when menu is active
    createAppKeymap({ onSave, onClose }),
    createFormattingKeymap(),
    createInputRules(),
    createBaseKeymap(),
    history(),
    dropCursor(),
    gapCursor(),
    autoJoinAdjacentLists(),
    placeholderPlugin(),
    askAiPlugin(),
    bubbleMenuPlugin({ onAskAI }),
    linkClickPlugin(),
    createSearchPlugin(onSearchInfo),
  ];
}
