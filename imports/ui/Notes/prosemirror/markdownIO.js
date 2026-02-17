import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { schema } from './schema.js';

// Zero-width space used as placeholder for blank lines
const ZWS = '\u200B';

// --- Preprocessing: normalize line breaks + preserve blank lines ---
// Each line becomes its own block (paragraph). Blank lines are preserved as
// paragraphs containing a zero-width space (invisible, but survives round-trip).
function normalizeLineBreaks(md) {
  const parts = md.split(/(```[\s\S]*?```)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // code blocks — don't touch

    return part.replace(/\n+/g, (match) => {
      const count = match.length;
      if (count <= 2) {
        // 1 or 2 newlines → single paragraph break
        return '\n\n';
      }
      // 3+ newlines: paragraph break + (count-2) blank line markers
      return '\n\n' + (`${ZWS}\n\n`).repeat(count - 2);
    });
  }).join('');
}

// --- Highlight support: parse ==color:text== syntax ---

function highlightPlugin(md) {
  // Inline rule to detect ==color:text== or ==text==
  md.inline.ruler.push('highlight', (state, silent) => {
    const start = state.pos;
    const max = state.posMax;
    const src = state.src;

    // Must start with ==
    if (src.charCodeAt(start) !== 0x3D || src.charCodeAt(start + 1) !== 0x3D) return false;

    // Find closing ==
    let end = start + 2;
    while (end < max - 1) {
      if (src.charCodeAt(end) === 0x3D && src.charCodeAt(end + 1) === 0x3D) break;
      end++;
    }
    if (end >= max - 1) return false;

    const content = src.slice(start + 2, end);
    if (!content) return false;

    if (!silent) {
      // Check for color prefix (e.g., "yellow:text" or just "text")
      let color = 'yellow';
      let text = content;
      const colonIdx = content.indexOf(':');
      if (colonIdx > 0) {
        const possibleColor = content.slice(0, colonIdx);
        if (['yellow', 'green', 'blue', 'pink', 'orange'].includes(possibleColor)) {
          color = possibleColor;
          text = content.slice(colonIdx + 1);
        }
      }

      const tokenOpen = state.push('highlight_open', 'mark', 1);
      tokenOpen.attrSet('data-color', color);

      const tokenText = state.push('text', '', 0);
      tokenText.content = text;

      state.push('highlight_close', 'mark', -1);
    }

    state.pos = end + 2;
    return true;
  });
}

// --- Text color support: parse ~color:text~ syntax ---

function textColorPlugin(md) {
  // Inline rule to detect ~color:text~ (single tilde, not ~~ which is strikethrough)
  md.inline.ruler.push('textColor', (state, silent) => {
    const start = state.pos;
    const max = state.posMax;
    const src = state.src;

    // Must start with ~ but not ~~
    if (src.charCodeAt(start) !== 0x7E) return false;
    if (src.charCodeAt(start + 1) === 0x7E) return false; // Skip ~~ (strikethrough)

    // Find closing ~ (but not ~~)
    let end = start + 1;
    while (end < max) {
      if (src.charCodeAt(end) === 0x7E && src.charCodeAt(end + 1) !== 0x7E) break;
      end++;
    }
    if (end >= max) return false;

    const content = src.slice(start + 1, end);
    if (!content) return false;

    // Must have color:text format
    const colonIdx = content.indexOf(':');
    if (colonIdx <= 0) return false;

    const possibleColor = content.slice(0, colonIdx);
    const validColors = ['red', 'green', 'blue', 'purple', 'orange'];
    if (!validColors.includes(possibleColor)) return false;

    const text = content.slice(colonIdx + 1);
    if (!text) return false;

    if (!silent) {
      const tokenOpen = state.push('textcolor_open', 'span', 1);
      tokenOpen.attrSet('data-color', possibleColor);

      const tokenText = state.push('text', '', 0);
      tokenText.content = text;

      state.push('textcolor_close', 'span', -1);
    }

    state.pos = end + 1;
    return true;
  });
}

// --- Task list support: detect [ ] / [x] in list items ---

function taskListPlugin(md) {
  // Runs before inline parsing so children are built from the stripped content
  md.core.ruler.before('inline', 'task-lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'list_item_open') continue;

      // Find the next inline token (after paragraph_open)
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'inline') {
          const match = /^\[([ xX])\] /.exec(tokens[j].content);
          if (match) {
            const checked = match[1] !== ' ';
            tokens[i].attrSet('data-checked', checked ? 'true' : 'false');
            tokens[j].content = tokens[j].content.slice(match[0].length);
          }
          break;
        }
        if (tokens[j].type === 'list_item_close') break;
      }
    }
  });
}

// --- Parser: markdown string → ProseMirror Doc ---

function listIsTight(tokens, i) {
  while (++i < tokens.length)
    {if (tokens[i].type !== 'list_item_open') return tokens[i].hidden;}
  return false;
}

const md = MarkdownIt('commonmark', { html: false });
md.use(highlightPlugin);
md.use(textColorPlugin);
md.use(taskListPlugin);

const markdownParser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: {
    block: 'list_item',
    getAttrs: (tok) => {
      const checked = tok.attrGet('data-checked');
      if (checked === null) return { checked: null };
      return { checked: checked === 'true' };
    },
  },
  bullet_list: { block: 'bullet_list', getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok, tokens, i) => ({
      order: +tok.attrGet('start') || 1,
      tight: listIsTight(tokens, i),
    }),
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok) => ({ params: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: (tok.children?.[0] && tok.children[0].content) || null,
    }),
  },
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({
      href: tok.attrGet('href'),
      title: tok.attrGet('title') || null,
    }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
  highlight: {
    mark: 'highlight',
    getAttrs: (tok) => ({ color: tok.attrGet('data-color') || 'yellow' }),
  },
  textcolor: {
    mark: 'textColor',
    getAttrs: (tok) => ({ color: tok.attrGet('data-color') }),
  },
});

// --- Serializer: ProseMirror Doc → markdown string ---

const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    // Override list serializers: use flushClose(2) instead of the default
    // flushClose(3) between adjacent same-type lists. The extra newline from
    // flushClose(3) creates a phantom blank line that the user can never delete
    // (serialize adds \n\n\n → parser creates ZWS paragraph → user deletes it
    // → two adjacent lists → serialize adds \n\n\n again — infinite loop).
    // With flushClose(2), adjacent lists produce \n\n which MarkdownIt merges
    // into a single list on reload.
    bullet_list(state, node) {
      if (state.closed && state.closed.type === node.type) state.flushClose(2);
      state.renderList(node, '  ', () => (node.attrs.bullet || '*') + ' ');
    },
    ordered_list(state, node) {
      if (state.closed && state.closed.type === node.type) state.flushClose(2);
      const start = node.attrs.order || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(' ', maxW + 2);
      state.renderList(node, space, i => {
        const nStr = String(start + i);
        return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
      });
    },
    paragraph(state, node) {
      if (node.content.size === 0) {
        // Empty paragraph → ZWS marker so blank lines survive round-trip
        state.write(ZWS);
      } else {
        state.renderInline(node);
      }
      state.closeBlock(node);
    },
    list_item(state, node) {
      if (node.attrs.checked !== null) {
        state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      }
      state.renderContent(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    highlight: {
      open(state, mark) {
        return mark.attrs.color === 'yellow' ? '==' : `==${mark.attrs.color}:`;
      },
      close: '==',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    textColor: {
      open(state, mark) {
        return `~${mark.attrs.color}:`;
      },
      close: '~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

/**
 * Parse a markdown string into a ProseMirror document.
 * @param {string} md
 * @returns {import('prosemirror-model').Node}
 */
export function parseMarkdown(md) {
  return markdownParser.parse(normalizeLineBreaks(md || ''));
}

/**
 * Serialize a ProseMirror document to a markdown string.
 * @param {import('prosemirror-model').Node} doc
 * @returns {string}
 */
export function serializeMarkdown(doc) {
  let md = markdownSerializer.serialize(doc);
  // Convert ZWS markers back to blank lines
  md = md.replace(/\u200B\n\n/g, '\n');
  md = md.replace(/\u200B$/g, '');
  return md;
}
