import { Meteor } from 'meteor/meteor';

// Thin GitHub REST client using native fetch (Node 20 under Meteor 3).
// No octokit dependency. All calls authenticated with a PAT (repo:read scope).

const API = 'https://api.github.com';

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'panorama-staffing'
});

const ghGet = async (path, token) => {
  const res = await fetch(`${API}${path}`, { headers: ghHeaders(token) });
  if (res.ok) return res.json();
  const body = await res.text().catch(() => '');
  const snippet = body.slice(0, 200);
  if (res.status === 401) throw new Meteor.Error('github-auth', `GitHub 401 (token invalid/expired) on ${path}. ${snippet}`);
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (/not accessible by integration|resource not accessible/i.test(body)) {
      throw new Meteor.Error('github-permission', `GitHub 403 on ${path}: the App lacks the required permission (need Contents: read). ${snippet}`);
    }
    if (remaining === '0') {
      throw new Meteor.Error('github-rate', `GitHub rate limit hit on ${path}.`);
    }
    throw new Meteor.Error('github-forbidden', `GitHub 403 on ${path} (rate-limit remaining=${remaining}). ${snippet}`);
  }
  if (res.status === 404) throw new Meteor.Error('github-notfound', `GitHub 404 (resource not found / no access) on ${path}. ${snippet}`);
  throw new Meteor.Error('github-http', `GitHub HTTP ${res.status} on ${path}. ${snippet}`);
};

/** Repo metadata — used to learn the default branch. */
export const fetchRepoMeta = async (repo, token) => {
  const data = await ghGet(`/repos/${repo}`, token);
  return { defaultBranch: data.default_branch };
};

/** List branches (paginated, capped). Returns [{ name, sha }]. */
export const fetchBranches = async (repo, token, { maxPages = 3 } = {}) => {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await ghGet(`/repos/${repo}/branches?per_page=100&page=${page}`, token);
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach(b => out.push({ name: b.name, sha: b.commit?.sha }));
    if (data.length < 100) break;
  }
  return out;
};

/**
 * List pull requests sorted by most-recently-updated (the real "active work" feed).
 * Stops as soon as PRs fall outside the window (the list is sorted desc, so it's safe).
 * Returns [{ number, headRef, headSha, baseRef, authorLogin, updatedAt }].
 */
export const fetchPullRequests = async (repo, token, { since, max = 80 } = {}) => {
  const out = [];
  for (let page = 1; page <= 4 && out.length < max; page++) {
    const data = await ghGet(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, token);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const pr of data) {
      const updatedAt = pr.updated_at ? new Date(pr.updated_at) : null;
      if (since && updatedAt && updatedAt < since) return out;   // sorted desc → everything after is older
      out.push({
        number: pr.number,
        headRef: pr.head?.ref,
        headSha: pr.head?.sha,
        baseRef: pr.base?.ref,
        authorLogin: pr.user?.login || null,
        updatedAt
      });
      if (out.length >= max) return out;
    }
    if (data.length < 100) break;
  }
  return out;
};

/**
 * Commits on a branch (default: the repo default branch) within the window.
 * Only needs `contents: read`. Returns [{ sha, message, authorLogin, authorEmail, committedAt }].
 */
export const fetchBranchCommits = async (repo, token, { branch = 'master', since, max = 600 } = {}) => {
  const out = [];
  const sinceParam = since ? `&since=${encodeURIComponent(since.toISOString())}` : '';
  for (let page = 1; page <= 8 && out.length < max; page++) {
    const data = await ghGet(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100&page=${page}${sinceParam}`, token);
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach(c => out.push({
      sha: c.sha,
      message: c.commit?.message || '',
      authorLogin: c.author?.login || null,
      authorEmail: (c.commit?.author?.email || '').toLowerCase(),
      committedAt: c.commit?.author?.date ? new Date(c.commit.author.date) : null
    }));
    if (data.length < 100) break;
  }
  return out.slice(0, max);
};

/**
 * Compare base...head — one call gives the commits ahead AND the union of files changed.
 * Returns { aheadBy, commits: [{sha, message, authorName, authorEmail, authorLogin, committedAt}], files: [filename] }.
 */
export const fetchBranchActivity = async (repo, base, head, token) => {
  const enc = encodeURIComponent(head);
  const data = await ghGet(`/repos/${repo}/compare/${base}...${enc}?per_page=100`, token);
  const commits = (data.commits || []).map(c => ({
    sha: c.sha,
    message: c.commit?.message || '',
    authorName: c.commit?.author?.name || '',
    authorEmail: (c.commit?.author?.email || '').toLowerCase(),
    authorLogin: c.author?.login || null,
    committedAt: c.commit?.author?.date ? new Date(c.commit.author.date) : null
  }));
  const files = (data.files || []).map(f => f.filename).filter(Boolean);
  return { aheadBy: data.ahead_by || 0, commits, files };
};
