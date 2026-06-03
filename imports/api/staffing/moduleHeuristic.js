// Heuristic: map a changed file path to a functional module of the monorepo.
// Generic, path-convention based — no hardcoded module list, so new modules are
// auto-discovered. Tuned for the lempire/lemapp layout but degrades gracefully.

// Top-level dirs that are themselves a "module" (no deeper grouping segment).
const TOP_LEVEL_MODULES = new Set(['server', 'packages', 'lib', 'lemgod', 'lemcal', 'lemwarm']);
// Dirs whose immediate child is the meaningful module (e.g. lemlist/<mod>, modules/<mod>).
const GROUPING_DIRS = new Set(['lemlist', 'modules']);

const moduleForPath = (rawPath) => {
  const path = String(rawPath || '').replace(/^\/+/, '');
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // Strip a leading "lemapp/" (monorepo root) if present.
  const segs = parts[0] === 'lemapp' ? parts.slice(1) : parts;
  if (segs.length === 0) return parts[0];

  const head = segs[0];
  if (GROUPING_DIRS.has(head) && segs.length > 1) return segs[1];
  if (TOP_LEVEL_MODULES.has(head)) return head;
  return head;
};

/**
 * Given a list of changed file paths, return module breakdown.
 * @returns { modules: [{module, count}], primaryModule: string|null }
 */
export const modulesFromFiles = (files = []) => {
  const counts = new Map();
  for (const f of files) {
    const filename = typeof f === 'string' ? f : f?.filename;
    const mod = moduleForPath(filename);
    if (!mod) continue;
    counts.set(mod, (counts.get(mod) || 0) + 1);
  }
  const modules = [...counts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count);
  return { modules, primaryModule: modules[0]?.module || null };
};
