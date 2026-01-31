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

// --- Parser: markdown string → ProseMirror Doc ---

function listIsTight(tokens, i) {
  while (++i < tokens.length)
    if (tokens[i].type !== 'list_item_open') return tokens[i].hidden;
  return false;
}

const markdownParser = new MarkdownParser(schema, MarkdownIt('commonmark', { html: false }), {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
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
});

// --- Serializer: ProseMirror Doc → markdown string ---

const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    paragraph(state, node) {
      if (node.content.size === 0) {
        // Empty paragraph → ZWS marker so blank lines survive round-trip
        state.write(ZWS);
      } else {
        state.renderInline(node);
      }
      state.closeBlock(node);
    },
  },
  defaultMarkdownSerializer.marks,
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
