import { Schema } from 'prosemirror-model';
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic';
import { orderedList, bulletList, listItem } from 'prosemirror-schema-list';

// Highlight mark for colored text backgrounds
const highlightMark = {
  attrs: { color: { default: 'yellow' } },
  parseDOM: [{
    tag: 'mark',
    getAttrs: (dom) => ({ color: dom.getAttribute('data-color') || 'yellow' }),
  }],
  toDOM(node) {
    return ['mark', { 'data-color': node.attrs.color, class: `highlight-${node.attrs.color}` }, 0];
  },
};

// Text color mark for colored foreground text
const textColorMark = {
  attrs: { color: { default: 'red' } },
  parseDOM: [{
    tag: 'span[data-text-color]',
    getAttrs: (dom) => ({ color: dom.getAttribute('data-text-color') }),
  }],
  toDOM(node) {
    return ['span', { 'data-text-color': node.attrs.color, class: `text-color-${node.attrs.color}` }, 0];
  },
};

export const schema = new Schema({
  nodes: {
    ...basicNodes,
    ordered_list: { ...orderedList, content: 'list_item+', group: 'block' },
    bullet_list: { ...bulletList, content: 'list_item+', group: 'block' },
    list_item: {
      ...listItem,
      content: 'paragraph block*',
      attrs: { checked: { default: null } },
      parseDOM: [
        {
          tag: 'li[data-checked]',
          getAttrs(dom) {
            return { checked: dom.getAttribute('data-checked') === 'true' };
          },
        },
        { tag: 'li' },
      ],
      toDOM(node) {
        if (node.attrs.checked !== null) {
          return ['li', {
            class: `task-item${node.attrs.checked ? ' task-item-checked' : ''}`,
            'data-checked': node.attrs.checked ? 'true' : 'false',
          }, 0];
        }
        return ['li', 0];
      },
    },
  },
  marks: { ...basicMarks, highlight: highlightMark, textColor: textColorMark },
});
