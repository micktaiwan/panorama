import { Schema } from 'prosemirror-model';
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic';
import { orderedList, bulletList, listItem } from 'prosemirror-schema-list';

export const schema = new Schema({
  nodes: {
    ...basicNodes,
    ordered_list: { ...orderedList, content: 'list_item+', group: 'block' },
    bullet_list: { ...bulletList, content: 'list_item+', group: 'block' },
    list_item: { ...listItem, content: 'paragraph block*' },
  },
  marks: basicMarks,
});
