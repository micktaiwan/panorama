import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { schema } from './schema.js';

// # Heading → heading level 1-6
function headingRule(nodeType, maxLevel) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${maxLevel}})\\s$`),
    nodeType,
    (match) => ({ level: match[1].length }),
  );
}

// > text → blockquote
function blockquoteRule(nodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType);
}

// - or * → bullet list
function bulletListRule(nodeType) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType);
}

// 1. → ordered list
function orderedListRule(nodeType) {
  return wrappingInputRule(
    /^(\d+)\.\s$/,
    nodeType,
    (match) => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order === +match[1],
  );
}

// ``` → code block
function codeBlockRule(nodeType) {
  return textblockTypeInputRule(/^```$/, nodeType);
}

// --- → horizontal rule
function horizontalRuleRule(nodeType) {
  return new InputRule(/^---$/, (state, match, start, end) => {
    return state.tr
      .replaceWith(start - 1, end, nodeType.create())
      .scrollIntoView();
  });
}

export function createInputRules() {
  const { heading, blockquote, code_block, bullet_list, ordered_list, horizontal_rule } = schema.nodes;

  return inputRules({
    rules: [
      headingRule(heading, 6),
      blockquoteRule(blockquote),
      bulletListRule(bullet_list),
      orderedListRule(ordered_list),
      codeBlockRule(code_block),
      horizontalRuleRule(horizontal_rule),
    ],
  });
}
