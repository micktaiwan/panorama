import { OPTIONAL_PAGES } from '../router.js';

/**
 * Check if a page is visible to the given user.
 * Core pages always return true.
 * Optional pages require admin + explicit opt-in via userPrefs.visiblePages.
 */
export const canSeePage = (pageKey, user, userPrefs) => {
  if (!(pageKey in OPTIONAL_PAGES)) return true;
  if (!user?.isAdmin) return false;
  return (userPrefs?.visiblePages || []).includes(pageKey);
};
