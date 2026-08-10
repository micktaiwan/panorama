// Automatic link detection in notes.
// Every URL written in a note becomes a Link of the same project, so the links
// panel reflects what was actually collected while taking notes instead of
// having to be fed by hand.

import { LinksCollection } from './collections';

// Bare URLs and markdown links. Trailing punctuation is stripped afterwards.
const URL_REGEX = /https?:\/\/[^\s<>()[\]"']+/gi;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;

// Sentence punctuation that a URL never really ends with.
const TRAILING_JUNK = /[.,;:!?]+$/;

/** Strip what a sentence added around the URL. */
const cleanUrl = (raw) => String(raw || '').trim().replace(TRAILING_JUNK, '');

/**
 * Comparison key: same page written two ways must not create two links.
 * Scheme, "www.", a trailing slash and the fragment are ignored.
 */
export const normalizeUrlKey = (url) => {
  const cleaned = cleanUrl(url).toLowerCase();
  return cleaned
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+$/, '');
};

/** Readable fallback name when the note gave no label: host + first path segment. */
const nameFromUrl = (url) => {
  const withoutScheme = cleanUrl(url).replace(/^https?:\/\//, '').replace(/^www\./, '');
  const [host, ...rest] = withoutScheme.split('/');
  const firstSegment = rest.filter(Boolean)[0];
  return firstSegment ? `${host}/${firstSegment}` : host;
};

/**
 * All URLs found in a text, deduped, with the best available name:
 * the markdown label when there is one, the host otherwise.
 * @returns {Array<{url: string, name: string}>}
 */
export const extractLinks = (text) => {
  const content = String(text || '');
  const byKey = new Map();

  for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
    const url = cleanUrl(match[2]);
    const label = String(match[1] || '').trim();
    const key = normalizeUrlKey(url);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { url, name: label || nameFromUrl(url) });
  }

  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanUrl(match[0]);
    const key = normalizeUrlKey(url);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { url, name: nameFromUrl(url) });
  }

  return [...byKey.values()];
};

/**
 * Create the links a note mentions and that do not exist yet in its project.
 * Never updates nor deletes anything: a link the user renamed or removed by
 * hand stays as they left it.
 *
 * @returns {Promise<{created: number, urls: string[]}>}
 */
export const syncLinksFromNote = async ({ noteId, projectId, content, userId }) => {
  if (!userId) return { created: 0, urls: [] };
  const found = extractLinks(content);
  if (found.length === 0) return { created: 0, urls: [] };

  // Existing links of the same scope (project, or the user's project-less links)
  const scope = projectId ? { projectId } : { userId, projectId: { $in: [null, ''] } };
  const existing = await LinksCollection.find(scope, { fields: { url: 1 } }).fetchAsync();
  const known = new Set((existing || []).map(l => normalizeUrlKey(l.url)));

  const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
  const now = new Date();
  const created = [];
  for (const link of found) {
    const key = normalizeUrlKey(link.url);
    if (known.has(key)) continue;
    known.add(key);
    const linkId = await LinksCollection.insertAsync({
      projectId: projectId || undefined,
      name: link.name,
      url: link.url,
      userId,
      autoDetected: true,
      sourceNoteId: noteId || undefined,
      clicksCount: 0,
      lastClickedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    // Index like a hand-created link; a failure here must not lose the link.
    try {
      await upsertDoc({ kind: 'link', id: linkId, text: `${link.name} ${link.url}`.trim(), projectId: projectId || null, userId });
    } catch (e) {
      console.error('[search][links.autoDetect] upsert failed', linkId, e);
    }
    created.push(link.url);
  }

  if (created.length > 0) {
    console.log(`[links][autoDetect] Created ${created.length} link(s) from note ${noteId || '(unsaved)'}`);
  }
  return { created: created.length, urls: created };
};
