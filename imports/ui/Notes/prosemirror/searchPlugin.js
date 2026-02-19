import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const searchPluginKey = new PluginKey('search');

/**
 * Find all case-insensitive occurrences of `query` in the ProseMirror doc.
 * Returns an array of { from, to } positions.
 */
function findMatches(doc, query) {
  if (!query) return [];
  const matches = [];
  const lower = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(lower);
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      idx = text.indexOf(lower, idx + 1);
    }
  });

  return matches;
}

/**
 * Create a ProseMirror search plugin.
 * @param {(count: number, currentIndex: number) => void} onSearchInfo - callback when matches change
 */
export function createSearchPlugin(onSearchInfo) {
  return new Plugin({
    key: searchPluginKey,

    state: {
      init() {
        return { query: '', matches: [], currentIndex: -1 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(searchPluginKey);

        if (meta?.query !== undefined) {
          // Query changed
          const query = meta.query;
          if (!query) {
            return { query: '', matches: [], currentIndex: -1 };
          }
          const matches = findMatches(tr.doc, query);
          return { query, matches, currentIndex: matches.length > 0 ? 0 : -1 };
        }

        if (meta?.navigate) {
          const { matches, currentIndex } = prev;
          if (matches.length === 0) return prev;
          let next;
          if (meta.navigate === 'next') {
            next = (currentIndex + 1) % matches.length;
          } else {
            next = (currentIndex - 1 + matches.length) % matches.length;
          }
          return { ...prev, currentIndex: next };
        }

        // Doc changed — recompute matches with same query
        if (tr.docChanged && prev.query) {
          const matches = findMatches(tr.doc, prev.query);
          const currentIndex = matches.length > 0
            ? Math.min(prev.currentIndex, matches.length - 1)
            : -1;
          return { ...prev, matches, currentIndex };
        }

        return prev;
      },
    },

    props: {
      decorations(state) {
        const { matches, currentIndex } = searchPluginKey.getState(state);
        if (matches.length === 0) return DecorationSet.empty;

        const decos = matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class: i === currentIndex ? 'pm-search-match pm-search-match-current' : 'pm-search-match',
          })
        );
        return DecorationSet.create(state.doc, decos);
      },
    },

    view() {
      return {
        update(view, prevState) {
          const cur = searchPluginKey.getState(view.state);
          const prev = searchPluginKey.getState(prevState);
          if (!cur || !prev) return;

          const matchesChanged = cur.matches !== prev.matches || cur.currentIndex !== prev.currentIndex;
          if (!matchesChanged) return;

          onSearchInfo?.(cur.matches.length, cur.currentIndex);

          // Scroll to current match via DOM (ProseMirror's scrollIntoView flag
          // is not handled by the custom dispatchTransaction in ProseMirrorEditor)
          if (cur.currentIndex >= 0 && cur.currentIndex !== prev.currentIndex) {
            setTimeout(() => {
              view.dom.querySelector('.pm-search-match-current')
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 0);
          }
        },
      };
    },
  });
}
