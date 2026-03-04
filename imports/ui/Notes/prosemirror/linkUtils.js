const URL_RE = /^https?:\/\/\S+$/;

/**
 * Quick check: does the text look like an http(s) URL?
 * Uses regex for speed, then validates with the URL constructor.
 */
export function looksLikeUrl(text) {
  if (!URL_RE.test(text)) return false;
  try { new URL(text); return true; } catch { return false; }
}
