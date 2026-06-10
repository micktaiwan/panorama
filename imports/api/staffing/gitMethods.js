import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';
import { getGithubConfigAsync } from '/imports/api/_shared/config';
import { PeopleCollection } from '/imports/api/people/collections';
import { handlesOf } from '/imports/api/people/githubHandles';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { StaffingCollection } from './collections';
import { CommitsCollection, BranchClassificationsCollection, OpportunitySuggestionsCollection } from './gitCollections';
import { fetchRepoMeta, fetchBranchCommits, fetchCommitDetail } from './githubClient';
import { resolveGithubToken } from './githubAppAuth';
import { rankCommitsBatch, rankCommitDeep, suggestProjectKeywords } from './classifier';

// How many commits we send to the LLM per ranking call (internal batching).
// Kept small so a single call stays well under the LLM timeout.
const RANK_BATCH = 8;

// Window for the per-person "Fetch git" button on the detail page (days).
// Fixed and intentionally short — independent of the global analysis window.
const PERSON_FETCH_DAYS = 3;

// Conventional-commit scope: "type(scope): subject" -> scope; "type: subject" -> type.
// Strips a leading "N - " / "N " stacking prefix used in the lempire repo.
const scopeOf = (msg) => {
  const t = String(msg || '').replace(/^\s*\d+\s*-?\s*/, '').trim();
  const m = t.match(/^(\w+)(?:\(([^)]+)\))?!?:/);
  return m ? (m[2] || m[1] || 'autre').toLowerCase() : 'autre';
};

// Live progress of the running analysis, keyed by userId, polled by the client.
const analysisProgress = new Map();

// Mutual-exclusion + coalescing for the heavy staffing ops (full analysis / rerank).
// `staffingRunning` holds userIds with an analysis OR rerank in flight; `rerankPending`
// records that a rerank was requested while busy → it runs exactly once more at the end
// instead of stacking N concurrent reranks (which would multiply the LLM cost and clobber
// the shared progress entry).
const staffingRunning = new Set();
const rerankPending = new Set();

// One full pass over the unclassified commits: re-rank them against current projects and
// overwrite their `candidates`. Extracted so the rerank method can loop it for coalescing.
const runRerankPass = async (userId, startedAt) => {
  const opportunities = await OpportunitiesCollection.find(
    { userId }, { fields: { name: 1, keywords: 1 } }
  ).fetchAsync();
  const commits = await CommitsCollection.find(
    { userId, opportunityId: { $exists: false }, noProject: { $ne: true } },
    { fields: { sha: 1, message: 1 } }
  ).fetchAsync();
  if (opportunities.length === 0 || commits.length === 0) return { ranked: 0, total: commits.length };

  let ranked = 0;
  const now = new Date();
  const batches = Math.ceil(commits.length / RANK_BATCH);
  for (let i = 0; i < batches; i++) {
    analysisProgress.set(userId, { phase: 'ranking', current: i + 1, total: batches, startedAt });
    const slice = commits.slice(i * RANK_BATCH, i * RANK_BATCH + RANK_BATCH);
    let map = new Map();
    try {
      map = await rankCommitsBatch({ commits: slice, opportunities }, userId);
    } catch (e) {
      // One slow/aborted batch must not fail the whole rerank — log and skip it.
      console.error(`[staffing.rerankUnclassified] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
    }
    for (const c of slice) {
      const candidates = map.get(c.sha) || [];
      await CommitsCollection.updateAsync({ userId, sha: c.sha }, { $set: { candidates, rankedAt: now } });
      if (candidates.length) ranked++;
    }
  }
  return { ranked, total: commits.length };
};

/**
 * Resolve a commit author to a person owned by userId.
 * Match priority: GitHub login (any of the person's handles) > email.
 */
const buildAuthorResolver = (people) => {
  const byLogin = new Map();
  const byEmail = new Map();
  people.forEach(p => {
    handlesOf(p).forEach(login => byLogin.set(login, p._id));
    if (p.email) byEmail.set(p.email.toLowerCase(), p._id);
  });
  return (commit) => {
    if (commit.authorLogin && byLogin.has(commit.authorLogin.toLowerCase())) return byLogin.get(commit.authorLogin.toLowerCase());
    if (commit.authorEmail && byEmail.has(commit.authorEmail)) return byEmail.get(commit.authorEmail);
    return null;
  };
};

Meteor.methods({
  /**
   * Git analysis (per-commit model): fetch the default-branch commit stream, resolve
   * authors, then rank EACH commit against existing projects by reading its real
   * message + the projects' keywords (batched LLM calls). Nothing is auto-attached —
   * the top-5 candidates are stored on each commit; the user picks via the review UI.
   */
  async 'staffing.runGithubAnalysis'() {
    ensureLoggedIn(this.userId);
    this.unblock(); // allow the progress-poll method to run in parallel on this session
    const userId = this.userId;
    // Don't stack a full analysis on top of another analysis/rerank for the same user.
    if (staffingRunning.has(userId)) {
      throw new Meteor.Error('staffing-busy', 'Une analyse ou un recalcul est déjà en cours.');
    }
    staffingRunning.add(userId);
    const startedAt = Date.now();
    analysisProgress.set(userId, { phase: 'fetching', current: 0, total: 0, startedAt });
    try {
      const cfg = await getGithubConfigAsync(userId);
      if (!cfg.repo) {
        throw new Meteor.Error('config-missing', 'GitHub repo is required (set it in the Staffing > Git panel).');
      }
      const token = await resolveGithubToken(cfg); // GitHub App (server) or PAT

      const meta = await fetchRepoMeta(cfg.repo, token);
      const defaultBranch = cfg.defaultBranch || meta.defaultBranch || 'main';
      const since = new Date(Date.now() - cfg.windowDays * 24 * 60 * 60 * 1000);

      const [people, opportunities] = await Promise.all([
        PeopleCollection.find({ userId }, { fields: { githubUsername: 1, githubUsernames: 1, email: 1 } }).fetchAsync(),
        OpportunitiesCollection.find({ userId }, { fields: { name: 1, keywords: 1 } }).fetchAsync()
      ]);
      const resolveAuthor = buildAuthorResolver(people);

      const commits = await fetchBranchCommits(cfg.repo, token, { branch: defaultBranch, since, max: 1000 });

      // A GitHub fetch must only (re)rank UNCLASSIFIED commits. GitHub doesn't know the
      // classification state, so read it from the DB for the fetched shas: any commit
      // already attached to a project (opportunityId) or dismissed (noProject) is skipped.
      const fetchedShas = commits.map(c => c.sha).filter(Boolean);
      const classifiedDocs = await CommitsCollection.find(
        { userId, sha: { $in: fetchedShas }, $or: [{ opportunityId: { $exists: true } }, { noProject: true }] },
        { fields: { sha: 1 } }
      ).fetchAsync();
      const classifiedShas = new Set(classifiedDocs.map(d => d.sha));

      // Ingest. `scope` is kept only as a display hint — it no longer drives classification.
      let commitsIngested = 0;
      const unresolvedAuthors = new Set();
      const now = new Date();
      const toRank = []; // { sha, message } with the FULL message for the LLM (unclassified only)
      for (const c of commits) {
        if (!c.sha) continue;
        const scope = scopeOf(c.message);
        const pid = resolveAuthor(c);
        if (!pid && (c.authorLogin || c.authorEmail)) unresolvedAuthors.add(c.authorLogin || c.authorEmail);
        await CommitsCollection.upsertAsync(
          { userId, sha: c.sha },
          { $set: {
            userId, sha: c.sha, scope, message: (c.message || '').split('\n')[0].slice(0, 200),
            authorLogin: c.authorLogin, authorEmail: c.authorEmail,
            personId: pid, committedAt: c.committedAt || now, updatedAt: now
          } }
        );
        commitsIngested++;
        if (!classifiedShas.has(c.sha)) toRank.push({ sha: c.sha, message: c.message || '' });
      }

      // Rank every commit against existing projects, in batches, reading the real text.
      let ranked = 0;
      if (opportunities.length > 0 && toRank.length > 0) {
        const batches = Math.ceil(toRank.length / RANK_BATCH);
        for (let i = 0; i < batches; i++) {
          analysisProgress.set(userId, { phase: 'ranking', current: i + 1, total: batches, startedAt });
          const slice = toRank.slice(i * RANK_BATCH, i * RANK_BATCH + RANK_BATCH);
          let map = new Map();
          try {
            map = await rankCommitsBatch({ commits: slice, opportunities }, userId);
          } catch (e) {
            // One slow/aborted batch must not fail the whole run — log and skip it.
            console.error(`[staffing.runGithubAnalysis] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
          }
          for (const { sha } of slice) {
            const candidates = map.get(sha) || [];
            await CommitsCollection.updateAsync({ userId, sha }, { $set: { candidates, rankedAt: now } });
            if (candidates.length) ranked++;
          }
        }
      }

      return {
        commitsIngested,
        ranked,
        opportunities: opportunities.length,
        unresolvedAuthors: [...unresolvedAuthors].slice(0, 30),
        windowDays: cfg.windowDays,
        ranAt: now
      };
    } catch (err) {
      console.error('[staffing.runGithubAnalysis] failed:', err?.reason || err?.message || err, err?.stack || '');
      throw err;
    } finally {
      staffingRunning.delete(userId);
      rerankPending.delete(userId); // a rerank requested during the analysis is moot — analysis already ranked everything
      analysisProgress.delete(userId);
    }
  },

  /**
   * Fetch ONE person's recent commits from GitHub (filtered by their login + email on the
   * default branch, configured window), ingest them, and rank only the UNCLASSIFIED ones
   * against current projects. Scoped sibling of runGithubAnalysis for the person detail page.
   */
  async 'staffing.fetchPersonCommits'(personId) {
    check(personId, String);
    ensureLoggedIn(this.userId);
    this.unblock();
    const userId = this.userId;
    if (staffingRunning.has(userId)) {
      throw new Meteor.Error('staffing-busy', 'Une analyse ou un recalcul est déjà en cours.');
    }
    const person = await PeopleCollection.findOneAsync(
      { _id: personId, userId }, { fields: { githubUsername: 1, githubUsernames: 1, email: 1 } }
    );
    if (!person) throw new Meteor.Error('not-found', 'Personne introuvable.');
    const logins = handlesOf(person);
    const email = String(person.email || '').trim().toLowerCase();
    if (logins.length === 0 && !email) {
      throw new Meteor.Error('no-identity', 'Pas de github login ni d’email pour résoudre les commits de cette personne.');
    }

    staffingRunning.add(userId);
    const startedAt = Date.now();
    analysisProgress.set(userId, { phase: 'fetching', current: 0, total: 0, startedAt });
    try {
      const cfg = await getGithubConfigAsync(userId);
      if (!cfg.repo) {
        throw new Meteor.Error('config-missing', 'GitHub repo is required (set it in the Staffing > Git panel).');
      }
      const token = await resolveGithubToken(cfg);
      const meta = await fetchRepoMeta(cfg.repo, token);
      const defaultBranch = cfg.defaultBranch || meta.defaultBranch || 'main';
      // The person detail fetch is a quick "what did they do lately" — fixed 3-day window,
      // independent of the global analysis window (cfg.windowDays).
      const windowDays = PERSON_FETCH_DAYS;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      // Fetch by every login AND email (a commit may match any), merge by sha.
      const bySha = new Map();
      for (const author of [...logins, email].filter(Boolean)) {
        const list = await fetchBranchCommits(cfg.repo, token, { branch: defaultBranch, since, max: 500, author });
        for (const c of list) { if (c.sha) bySha.set(c.sha, c); }
      }
      const commits = [...bySha.values()];

      const opportunities = await OpportunitiesCollection.find(
        { userId }, { fields: { name: 1, keywords: 1 } }
      ).fetchAsync();

      // Only (re)rank commits not already attached to a project or dismissed.
      const fetchedShas = commits.map(c => c.sha);
      const classifiedDocs = await CommitsCollection.find(
        { userId, sha: { $in: fetchedShas }, $or: [{ opportunityId: { $exists: true } }, { noProject: true }] },
        { fields: { sha: 1 } }
      ).fetchAsync();
      const classifiedShas = new Set(classifiedDocs.map(d => d.sha));

      const now = new Date();
      let commitsIngested = 0;
      const toRank = [];
      for (const c of commits) {
        const scope = scopeOf(c.message);
        await CommitsCollection.upsertAsync(
          { userId, sha: c.sha },
          { $set: {
            userId, sha: c.sha, scope, message: (c.message || '').split('\n')[0].slice(0, 200),
            authorLogin: c.authorLogin, authorEmail: c.authorEmail,
            personId, committedAt: c.committedAt || now, updatedAt: now
          } }
        );
        commitsIngested++;
        if (!classifiedShas.has(c.sha)) toRank.push({ sha: c.sha, message: c.message || '' });
      }

      let ranked = 0;
      if (opportunities.length > 0 && toRank.length > 0) {
        const batches = Math.ceil(toRank.length / RANK_BATCH);
        for (let i = 0; i < batches; i++) {
          analysisProgress.set(userId, { phase: 'ranking', current: i + 1, total: batches, startedAt });
          const slice = toRank.slice(i * RANK_BATCH, i * RANK_BATCH + RANK_BATCH);
          let map = new Map();
          try {
            map = await rankCommitsBatch({ commits: slice, opportunities }, userId);
          } catch (e) {
            console.error(`[staffing.fetchPersonCommits] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
          }
          for (const { sha } of slice) {
            const candidates = map.get(sha) || [];
            await CommitsCollection.updateAsync({ userId, sha }, { $set: { candidates, rankedAt: now } });
            if (candidates.length) ranked++;
          }
        }
      }

      return { commitsIngested, ranked, unclassified: toRank.length, windowDays, ranAt: now };
    } catch (err) {
      console.error('[staffing.fetchPersonCommits] failed:', err?.reason || err?.message || err, err?.stack || '');
      throw err;
    } finally {
      staffingRunning.delete(userId);
      rerankPending.delete(userId);
      analysisProgress.delete(userId);
    }
  },

  /** Re-rank ONLY the unclassified commits (no opportunityId, not dismissed) against the
   *  CURRENT projects + keywords. Called after a project/keyword change so proposals refresh
   *  without touching already-classified commits or re-fetching from GitHub. */
  async 'staffing.rerankUnclassified'() {
    ensureLoggedIn(this.userId);
    this.unblock();
    const userId = this.userId;
    // Coalesce: if a heavy op is already running, register a single rerun and return
    // immediately instead of stacking another concurrent pass.
    if (staffingRunning.has(userId)) {
      rerankPending.add(userId);
      return { ranked: 0, total: 0, coalesced: true };
    }
    staffingRunning.add(userId);
    const startedAt = Date.now();
    analysisProgress.set(userId, { phase: 'ranking', current: 0, total: 0, startedAt });
    try {
      let result;
      do {
        rerankPending.delete(userId);            // consume any request that arrived mid-pass
        result = await runRerankPass(userId, startedAt);
      } while (rerankPending.has(userId));       // a request landed during the pass → run once more
      return result;
    } catch (err) {
      console.error('[staffing.rerankUnclassified] failed:', err?.reason || err?.message || err, err?.stack || '');
      throw err;
    } finally {
      staffingRunning.delete(userId);
      rerankPending.delete(userId);
      analysisProgress.delete(userId);
    }
  },

  /** Suggest keywords for a project based on ALL its classified commits (manual, returns
   *  proposals only — the user picks which to add). */
  async 'staffing.suggestKeywords'(opportunityId) {
    check(opportunityId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(OpportunitiesCollection, opportunityId, this.userId);
    this.unblock();
    const userId = this.userId;
    const opp = await OpportunitiesCollection.findOneAsync({ _id: opportunityId, userId }, { fields: { name: 1, keywords: 1 } });
    if (!opp) throw new Meteor.Error('not-found', 'Opportunity not found');
    const commits = await CommitsCollection.find(
      { userId, opportunityId },
      { fields: { message: 1 }, limit: 300 }
    ).fetchAsync();
    if (commits.length === 0) return { keywords: [], commitsConsidered: 0 };
    const keywords = await suggestProjectKeywords(
      { projectName: opp.name, currentKeywords: opp.keywords || [], commitMessages: commits.map(c => c.message) },
      userId
    );
    return { keywords, commitsConsidered: commits.length };
  },

  /** Wipe all Staffing test data for the calling user: commits, projects (opportunities),
   *  staffing rows, branch classifications and suggestions. Keeps people (github mapping)
   *  and teams. Destructive and irreversible. */
  async 'staffing.wipeData'() {
    ensureLoggedIn(this.userId);
    const userId = this.userId;
    const [commits, opportunities, staffing, classifications, suggestions] = await Promise.all([
      CommitsCollection.removeAsync({ userId }),
      OpportunitiesCollection.removeAsync({ userId }),
      StaffingCollection.removeAsync({ userId }),
      BranchClassificationsCollection.removeAsync({ userId }),
      OpportunitySuggestionsCollection.removeAsync({ userId })
    ]);
    return { commits, opportunities, staffing, classifications, suggestions };
  },

  /** Live progress of the running analysis for the calling user (null if idle). */
  'staffing.githubAnalysisProgress'() {
    ensureLoggedIn(this.userId);
    return analysisProgress.get(this.userId) || null;
  },

  /** Accept a suggestion: create the opportunity + staff its contributors, then remove it.
   *  An optional nameOverride lets the user rename the project before creation. */
  async 'staffing.acceptSuggestion'(suggestionId, nameOverride) {
    check(suggestionId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(OpportunitySuggestionsCollection, suggestionId, this.userId);
    const userId = this.userId;
    const sug = await OpportunitySuggestionsCollection.findOneAsync({ _id: suggestionId });
    if (!sug) return;

    const name = (typeof nameOverride === 'string' && nameOverride.trim()) ? nameOverride.trim() : sug.name;
    const last = await OpportunitiesCollection.findOneAsync({ userId }, { sort: { order: -1 }, fields: { order: 1 } });
    const opportunityId = await OpportunitiesCollection.insertAsync({
      name, status: 'in_progress', cycle: '', notionUrl: '',
      order: (last?.order ?? -1) + 1, userId, createdAt: new Date(), updatedAt: new Date()
    });

    const now = new Date();
    for (const personId of (sug.personIds || [])) {
      const existing = await StaffingCollection.findOneAsync({ userId, opportunityId, personId });
      if (existing) continue;
      await StaffingCollection.insertAsync({
        opportunityId, personId, role: 'dev', source: 'git', confidence: sug.confidence || 0.8,
        lastSeenAt: now, note: '', userId, createdAt: now, updatedAt: now
      });
    }

    // Re-point the cache for accepted branches so they don't resurface as suggestions.
    for (const branch of (sug.branches || [])) {
      await BranchClassificationsCollection.upsertAsync(
        { userId, branch },
        { $set: { userId, branch, opportunityId, confidence: 0.9, reasoning: 'accepted suggestion', classifiedAt: now } }
      );
    }

    await OpportunitySuggestionsCollection.removeAsync({ _id: suggestionId });
    return opportunityId;
  },

  /** Manually (re)attach a single commit to an opportunity, overriding its scope
   *  classification. Pass an empty opportunityId to clear the override (revert to scope). */
  async 'staffing.setCommitOpportunity'(sha, opportunityId) {
    check(sha, String);
    check(opportunityId, String);
    ensureLoggedIn(this.userId);
    const userId = this.userId;
    const commit = await CommitsCollection.findOneAsync({ userId, sha });
    if (!commit) throw new Meteor.Error('not-found', 'Commit not found');
    if (opportunityId === '__none__') {
      // "Aucun" — reviewed, belongs to no project. Drops out of the review queue.
      await CommitsCollection.updateAsync({ userId, sha }, { $set: { noProject: true, updatedAt: new Date() }, $unset: { opportunityId: '' } });
    } else if (opportunityId) {
      const opp = await OpportunitiesCollection.findOneAsync({ _id: opportunityId, userId });
      if (!opp) throw new Meteor.Error('not-found', 'Opportunity not found');
      await CommitsCollection.updateAsync({ userId, sha }, { $set: { opportunityId, updatedAt: new Date() }, $unset: { noProject: '' } });
    } else {
      // Clear any decision — back to the review queue.
      await CommitsCollection.updateAsync({ userId, sha }, { $unset: { opportunityId: '', noProject: '' }, $set: { updatedAt: new Date() } });
    }
  },

  async 'staffing.dismissSuggestion'(suggestionId) {
    check(suggestionId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(OpportunitySuggestionsCollection, suggestionId, this.userId);
    await OpportunitySuggestionsCollection.removeAsync({ _id: suggestionId });
  },

  /**
   * On-demand deep look at ONE commit: fetch its full GitHub detail (complete message,
   * changed files, stats). Read-only — used by the analysis modal to display the commit.
   */
  async 'staffing.fetchCommitDetail'(sha) {
    check(sha, String);
    ensureLoggedIn(this.userId);
    this.unblock();
    const commit = await CommitsCollection.findOneAsync({ userId: this.userId, sha });
    if (!commit) throw new Meteor.Error('not-found', 'Commit not found');
    const cfg = await getGithubConfigAsync(this.userId);
    if (!cfg.repo) throw new Meteor.Error('config-missing', 'GitHub repo is required (Staffing > Git panel).');
    const token = await resolveGithubToken(cfg);
    return fetchCommitDetail(cfg.repo, sha, token);
  },

  /**
   * Deep project analysis for ONE commit: re-fetch the full message + changed files,
   * then rank against EXISTING projects (richer signal than the first-line-only ranker).
   * Returns { candidates: [{ opportunityId, score, reasoning }] }. Does not write anything.
   */
  async 'staffing.analyzeCommitProjects'(sha) {
    check(sha, String);
    ensureLoggedIn(this.userId);
    this.unblock();
    const userId = this.userId;
    const commit = await CommitsCollection.findOneAsync({ userId, sha });
    if (!commit) throw new Meteor.Error('not-found', 'Commit not found');
    const cfg = await getGithubConfigAsync(userId);
    if (!cfg.repo) throw new Meteor.Error('config-missing', 'GitHub repo is required (Staffing > Git panel).');
    const token = await resolveGithubToken(cfg);
    const detail = await fetchCommitDetail(cfg.repo, sha, token);
    const opportunities = await OpportunitiesCollection.find(
      { userId }, { fields: { name: 1, keywords: 1 } }
    ).fetchAsync();
    const candidates = await rankCommitDeep({ message: detail.message, files: detail.files, opportunities }, userId);
    return { candidates };
  }
});
