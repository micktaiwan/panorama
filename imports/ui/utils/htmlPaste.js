import TurndownService from 'turndown';

// Instance singleton configurée
const turndown = new TurndownService({
  headingStyle: 'atx',        // # style headings
  bulletListMarker: '-',      // - for lists
  codeBlockStyle: 'fenced',   // ``` blocks
  emDelimiter: '*',           // *italic*
});

/**
 * Convertit du HTML en Markdown.
 * Retourne null si pas de HTML ou si le HTML est trivial (juste du texte).
 */
export function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return null;

  // Ignorer si c'est juste du texte sans balises significatives
  const hasFormatting = /<(p|div|h[1-6]|ul|ol|li|strong|em|b|i|a|code|pre|br|table|blockquote)[^>]*>/i.test(html);
  if (!hasFormatting) return null;

  return turndown.turndown(html);
}
