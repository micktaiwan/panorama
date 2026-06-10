// Shared helpers for a person's GitHub logins.
//
// A person can have MANY GitHub handles (`githubUsernames` array). The legacy
// singular field (`githubUsername`) is still read here so matching keeps working
// during the rollout / before the startup migration has unset it.

// Matching list: union of the array + legacy singular, trimmed, deduped, lowercased.
export const handlesOf = (person) => {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  };
  if (Array.isArray(person?.githubUsernames)) person.githubUsernames.forEach(push);
  if (person?.githubUsername) push(person.githubUsername);
  return out;
};

// Storage list: trimmed, deduped case-insensitively, original case preserved for display.
export const normalizeHandles = (arr) => {
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = String(v || '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
};
