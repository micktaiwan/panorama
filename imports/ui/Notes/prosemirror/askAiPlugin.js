import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const askAiKey = new PluginKey('askAi');

/**
 * ProseMirror plugin that maintains a tracked highlight decoration for "Ask AI".
 * Set the highlight via: tr.setMeta(askAiKey, { from, to })
 * Clear it via: tr.setMeta(askAiKey, null)
 * Positions auto-map through document changes.
 */
export function askAiPlugin() {
  return new Plugin({
    key: askAiKey,

    state: {
      init() {
        return null; // { from, to } or null
      },
      apply(tr, prev) {
        const meta = tr.getMeta(askAiKey);
        if (meta !== undefined) {
          // Explicit set or clear
          return meta;
        }
        if (prev && tr.docChanged) {
          // Remap positions through the mapping
          const from = tr.mapping.map(prev.from);
          const to = tr.mapping.map(prev.to);
          return from < to ? { from, to } : null;
        }
        return prev;
      },
    },

    props: {
      decorations(state) {
        const tracked = askAiKey.getState(state);
        if (!tracked) return DecorationSet.empty;
        const { from, to } = tracked;
        if (from >= to || to > state.doc.content.size) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [
          Decoration.inline(from, to, { class: 'ask-ai-highlight' }),
        ]);
      },
    },
  });
}
