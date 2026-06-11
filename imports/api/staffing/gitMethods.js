import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';
import { getGithubConfigAsync } from '/imports/api/_shared/config';
import { PeopleCollection } from '/imports/api/people/collections';
import { handlesOf } from '/imports/api/people/githubHandles';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { StaffingCollection } from './collections';
import { CommitsCollection, BranchClassificationsCollection } from './gitCollections';
import { fetchRepoMeta, fetchBranchCommits, fetchCommitDetail } from './githubClient';
import { resolveGithubToken } from './githubAppAuth';
import { rankCommitsBatch, rankCommitDeep, suggestProjectKeywords, normName, fileNamesOf, MAX_COMMIT_FILES } from './classifier';

// How many commits we send to the LLM per ranking call (internal batching).
// Kept small so a single call stays well under the LLM timeout.
const RANK_BATCH = 8;

// Adaptive deep-rescue pass: after batch ranking, commits whose best candidate scores
// below this (or that got no candidate) are re-ranked with their changed files fetched
// from GitHub. Keyword hits (0.95) are above the threshold, so they are never rescued.
const DEEP_RESCUE_THRESHOLD = 0.5;
// Hard cap of deep rescues per analysis run (1 GitHub call + 1 LLM call each).
const DEEP_RESCUE_MAX = 25;
// Abort the rescue pass after this many consecutive failures (LLM/GitHub down): the
// batch candidates are already written, so stopping early loses nothing.
const DEEP_RESCUE_MAX_FAILURES = 3;

// Window for the per-person "Fetch git" button on the detail page (days).
// Fixed and intentionally short — independent of the global analysis window.
const PERSON_FETCH_DAYS = 3;

// Strips the leading "N - " / "N " stacking prefix used in the lempire repo.
const stripStackPrefix = (msg) => String(msg || '').replace(/^\s*\d+\s*-?\s*/, '');

// Conventional-commit scope: "type(scope): subject" -> scope; "type: subject" -> type.
const scopeOf = (msg) => {
  const t = stripStackPrefix(msg).trim();
  const m = t.match(/^(\w+)(?:\(([^)]+)\))?!?:/);
  return m ? (m[2] || m[1] || 'autre').toLowerCase() : 'autre';
};

// Few-shot signal for the ranker: how many already-classified commit messages
// (first display line) are attached to each project as examples.
const EXAMPLES_PER_OPPORTUNITY = 3;
// Fetch extra candidates so near-duplicate messages (same PR stack) can be deduped.
const EXAMPLES_FETCH_LIMIT = 10;

/** Load the user's opportunities ({name, keywords}) with up to EXAMPLES_PER_OPPORTUNITY
 *  recent example messages from commits the user already classified into each one.
 *  Pass excludeSha when re-analyzing a classified commit so it can't be its own example. */
const loadOpportunitiesWithExamples = async (userId, { excludeSha } = {}) => {
  const opportunities = await OpportunitiesCollection.find(
    { userId }, { fields: { name: 1, keywords: 1 } }
  ).fetchAsync();
  await Promise.all(opportunities.map(async (o) => {
    const docs = await CommitsCollection.find(
      { userId, opportunityId: o._id, ...(excludeSha ? { sha: { $ne: excludeSha } } : {}) },
      { sort: { committedAt: -1 }, limit: EXAMPLES_FETCH_LIMIT, fields: { message: 1 } }
    ).fetchAsync();
    const seen = new Set();
    const examples = [];
    for (const d of docs) {
      const text = stripStackPrefix(d.message).trim();
      const key = normName(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      examples.push(text);
      if (examples.length >= EXAMPLES_PER_OPPORTUNITY) break;
    }
    o.examples = examples;
  }));
  return opportunities;
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
  const opportunities = await loadOpportunitiesWithExamples(userId);
  // Rank on messageFull (the multi-line message stored at ingest) — `message` is only
  // the truncated first display line; older docs predating messageFull fall back to it.
  // `files` (persisted by a deep fetch) rides along so reranks keep the path signal
  // without any GitHub call.
  const commits = (await CommitsCollection.find(
    { userId, opportunityId: { $exists: false }, noProject: { $ne: true } },
    { fields: { sha: 1, message: 1, messageFull: 1, files: 1 } }
  ).fetchAsync()).map(c => ({ sha: c.sha, message: c.messageFull || c.message, files: c.files }));
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
      // Defense-in-depth: LLM failures are handled inside rankCommitsBatch — this only
      // catches programming errors, so the slice still ends with candidates written.
      console.error(`[staffing.rerankUnclassified] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
    }
    for (const c of slice) {
      const candidates = map.get(c.sha) || [];
      // Overwriting a deep-ranked commit's candidates makes its deep status stale —
      // unset deepRankedAt so the next analysis may rescue it against the new projects.
      await CommitsCollection.updateAsync(
        { userId, sha: c.sha },
        { $set: { candidates, rankedAt: now }, $unset: { deepRankedAt: '' } }
      );
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
   * message + the projects' keywords and few-shot examples (batched LLM calls).
   * The weakest results are then re-ranked once with their changed files fetched from
   * GitHub (deep-rescue pass, bounded to DEEP_RESCUE_MAX). Nothing is auto-attached —
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
        loadOpportunitiesWithExamples(userId)
      ]);
      const resolveAuthor = buildAuthorResolver(people);

      const commits = await fetchBranchCommits(cfg.repo, token, { branch: defaultBranch, since, max: 1000 });

      // A GitHub fetch must only (re)rank UNCLASSIFIED commits. GitHub doesn't know the
      // classification state, so read it from the DB for the fetched shas: any commit
      // already attached to a project (opportunityId) or dismissed (noProject) is skipped.
      // Also reload the persisted `files` (from past deep fetches) so re-ranking keeps the
      // path signal, and the deep-ranked shas so the rescue budget goes to NEW weak commits.
      const fetchedShas = commits.map(c => c.sha).filter(Boolean);
      const existingDocs = await CommitsCollection.find(
        { userId, sha: { $in: fetchedShas } },
        { fields: { sha: 1, files: 1, opportunityId: 1, noProject: 1, deepRankedAt: 1 } }
      ).fetchAsync();
      const classifiedShas = new Set(existingDocs.filter(d => d.opportunityId || d.noProject).map(d => d.sha));
      const filesBySha = new Map(existingDocs.filter(d => d.files?.length).map(d => [d.sha, d.files]));
      const deepRankedShas = new Set(existingDocs.filter(d => d.deepRankedAt).map(d => d.sha));

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
            // `message` = short display line; `messageFull` = ranking signal (kept out of publications).
            userId, sha: c.sha, scope, message: (c.message || '').split('\n')[0].slice(0, 200),
            messageFull: (c.message || '').slice(0, 4000),
            authorLogin: c.authorLogin, authorEmail: c.authorEmail,
            personId: pid, committedAt: c.committedAt || now, updatedAt: now
          } }
        );
        commitsIngested++;
        // Same 4000-char cap as the stored messageFull, so a later rerank sees the identical
        // signal; persisted files ride along so deep-fetched commits keep their path signal.
        if (!classifiedShas.has(c.sha)) toRank.push({ sha: c.sha, message: (c.message || '').slice(0, 4000), files: filesBySha.get(c.sha) });
      }

      // Rank every commit against existing projects, in batches, reading the real text.
      let ranked = 0;
      const weakCommits = []; // no candidate, or best score under the rescue threshold
      if (opportunities.length > 0 && toRank.length > 0) {
        const batches = Math.ceil(toRank.length / RANK_BATCH);
        for (let i = 0; i < batches; i++) {
          analysisProgress.set(userId, { phase: 'ranking', current: i + 1, total: batches, startedAt });
          const slice = toRank.slice(i * RANK_BATCH, i * RANK_BATCH + RANK_BATCH);
          let map = new Map();
          try {
            map = await rankCommitsBatch({ commits: slice, opportunities }, userId);
          } catch (e) {
            // Defense-in-depth: LLM failures are handled inside rankCommitsBatch — this only
            // catches programming errors, so the slice still ends with candidates written.
            console.error(`[staffing.runGithubAnalysis] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
          }
          for (const { sha } of slice) {
            const candidates = map.get(sha) || [];
            await CommitsCollection.updateAsync({ userId, sha }, { $set: { candidates, rankedAt: now } });
            if (candidates.length) ranked++;
            // Already deep-ranked commits had their deep chance — their files keep feeding
            // the batch ranker; the rescue budget goes to commits never deepened.
            if (!deepRankedShas.has(sha) && (candidates[0]?.score ?? 0) < DEEP_RESCUE_THRESHOLD) {
              weakCommits.push({ sha, best: candidates[0]?.score ?? 0 });
            }
          }
        }
      }

      // Deep-rescue pass: re-rank the WEAKEST results with their changed files (bounded
      // cost: at most DEEP_RESCUE_MAX GitHub + LLM call pairs, weakest first). Aborts
      // after DEEP_RESCUE_MAX_FAILURES consecutive failures — the batch candidates are
      // already written, so stopping early loses nothing.
      let deepRescued = 0;
      if (opportunities.length > 0 && weakCommits.length > 0) {
        const targets = [...weakCommits].sort((a, b) => a.best - b.best).slice(0, DEEP_RESCUE_MAX);
        let failures = 0;
        for (let i = 0; i < targets.length; i++) {
          const { sha } = targets[i];
          if (failures >= DEEP_RESCUE_MAX_FAILURES) {
            console.error(`[staffing.runGithubAnalysis] deep rescue aborted after ${failures} consecutive failures (${targets.length - i} commits left)`);
            break;
          }
          // Reported as 'ranking' so the existing UI shows its lot counter ('deep' would
          // render as a bare "Analyse…" with no progression).
          analysisProgress.set(userId, { phase: 'ranking', current: i + 1, total: targets.length, startedAt });
          // The review queue stays live during the run — skip commits decided meanwhile.
          const fresh = await CommitsCollection.findOneAsync({ userId, sha }, { fields: { opportunityId: 1, noProject: 1 } });
          if (!fresh || fresh.opportunityId || fresh.noProject) continue;
          let detail;
          try {
            detail = await fetchCommitDetail(cfg.repo, sha, token);
          } catch (e) {
            failures++;
            console.error(`[staffing.runGithubAnalysis] deep rescue fetch (${sha}) failed:`, e?.reason || e?.message || e);
            continue;
          }
          // Persist the paths BEFORE ranking: even if the LLM call fails, the next rerank
          // keeps the path signal (prompt + keyword layer) without re-paying the GitHub call.
          const files = fileNamesOf(detail.files).slice(0, MAX_COMMIT_FILES);
          await CommitsCollection.updateAsync({ userId, sha }, { $set: { files } });
          try {
            const candidates = await rankCommitDeep({ message: detail.message, files: detail.files, opportunities }, userId);
            await CommitsCollection.updateAsync({ userId, sha }, { $set: { candidates, deepRankedAt: now } });
            if (candidates.length) deepRescued++;
            failures = 0;
          } catch (e) {
            failures++;
            console.error(`[staffing.runGithubAnalysis] deep rank (${sha}) failed:`, e?.reason || e?.message || e);
          }
        }
      }

      // Honor a rerank requested mid-analysis: project/keyword edits made during the run
      // are not covered by the opportunities snapshot taken at start. This overwrites the
      // just-computed deep candidates (they were ranked against the stale snapshot) but
      // also clears their deepRankedAt, so the next analysis can rescue them again.
      // A failure here must not turn the already-persisted analysis into an error.
      try {
        while (rerankPending.has(userId)) {
          rerankPending.delete(userId);
          await runRerankPass(userId, startedAt);
        }
      } catch (e) {
        console.error('[staffing.runGithubAnalysis] post-analysis rerank failed:', e?.reason || e?.message || e);
      }

      return {
        commitsIngested,
        ranked,
        deepRescued,
        weakCommits: weakCommits.length,
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
      rerankPending.delete(userId); // error path only — the success path consumed it above
      analysisProgress.delete(userId);
    }
  },

  /**
   * Fetch ONE person's recent commits from GitHub (filtered by their login + email on the
   * default branch, configured window), ingest them, and rank only the UNCLASSIFIED ones
   * against current projects. Scoped sibling of runGithubAnalysis for the person detail page.
   * No deep-rescue pass here — this is the quick "what did they do lately" view; a weak
   * candidate can still be deepened from the review modal.
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

      const opportunities = await loadOpportunitiesWithExamples(userId);

      // Only (re)rank commits not already attached to a project or dismissed. Reload the
      // persisted `files` (from past deep fetches) so re-ranking keeps the path signal.
      const fetchedShas = commits.map(c => c.sha);
      const existingDocs = await CommitsCollection.find(
        { userId, sha: { $in: fetchedShas } },
        { fields: { sha: 1, files: 1, opportunityId: 1, noProject: 1 } }
      ).fetchAsync();
      const classifiedShas = new Set(existingDocs.filter(d => d.opportunityId || d.noProject).map(d => d.sha));
      const filesBySha = new Map(existingDocs.filter(d => d.files?.length).map(d => [d.sha, d.files]));

      const now = new Date();
      let commitsIngested = 0;
      const toRank = [];
      for (const c of commits) {
        const scope = scopeOf(c.message);
        await CommitsCollection.upsertAsync(
          { userId, sha: c.sha },
          { $set: {
            userId, sha: c.sha, scope, message: (c.message || '').split('\n')[0].slice(0, 200),
            messageFull: (c.message || '').slice(0, 4000),
            authorLogin: c.authorLogin, authorEmail: c.authorEmail,
            personId, committedAt: c.committedAt || now, updatedAt: now
          } }
        );
        commitsIngested++;
        // Same 4000-char cap as the stored messageFull, so a later rerank sees the identical signal.
        if (!classifiedShas.has(c.sha)) toRank.push({ sha: c.sha, message: (c.message || '').slice(0, 4000), files: filesBySha.get(c.sha) });
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
            // Defense-in-depth: LLM failures are handled inside rankCommitsBatch.
            console.error(`[staffing.fetchPersonCommits] batch ${i + 1}/${batches} failed:`, e?.reason || e?.message || e);
          }
          for (const { sha } of slice) {
            const candidates = map.get(sha) || [];
            await CommitsCollection.updateAsync({ userId, sha }, { $set: { candidates, rankedAt: now } });
            if (candidates.length) ranked++;
          }
        }
      }

      // Honor a rerank requested mid-run (project/keyword edits during the fetch).
      // A failure here must not turn the already-persisted fetch into an error.
      try {
        while (rerankPending.has(userId)) {
          rerankPending.delete(userId);
          await runRerankPass(userId, startedAt);
        }
      } catch (e) {
        console.error('[staffing.fetchPersonCommits] post-fetch rerank failed:', e?.reason || e?.message || e);
      }

      return { commitsIngested, ranked, unclassified: toRank.length, windowDays, ranAt: now };
    } catch (err) {
      console.error('[staffing.fetchPersonCommits] failed:', err?.reason || err?.message || err, err?.stack || '');
      throw err;
    } finally {
      staffingRunning.delete(userId);
      rerankPending.delete(userId); // error path only — the success path consumed it above
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
   *  staffing rows and branch classifications. Keeps people (github mapping) and teams.
   *  Destructive and irreversible. */
  async 'staffing.wipeData'() {
    ensureLoggedIn(this.userId);
    const userId = this.userId;
    const [commits, opportunities, staffing, classifications] = await Promise.all([
      CommitsCollection.removeAsync({ userId }),
      OpportunitiesCollection.removeAsync({ userId }),
      StaffingCollection.removeAsync({ userId }),
      BranchClassificationsCollection.removeAsync({ userId })
    ]);
    return { commits, opportunities, staffing, classifications };
  },

  /** Live progress of the running analysis for the calling user (null if idle). */
  'staffing.githubAnalysisProgress'() {
    ensureLoggedIn(this.userId);
    return analysisProgress.get(this.userId) || null;
  },

  /** Manually attach a single commit to an opportunity — the user's decision from the
   *  review queue. '__none__' marks it reviewed-with-no-project (noProject); an empty
   *  opportunityId clears any decision and returns the commit to the review queue. */
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
   * then rank against EXISTING projects (richer signal than the batch ranker).
   * Persists the result: the commit's candidates are upgraded (review-queue chips
   * update) and the file paths are stored so later reranks keep the path signal.
   * Returns { candidates: [{ opportunityId, score, reasoning }] }.
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
    const opportunities = await loadOpportunitiesWithExamples(userId, { excludeSha: sha });
    const candidates = await rankCommitDeep({ message: detail.message, files: detail.files, opportunities }, userId);
    const now = new Date();
    await CommitsCollection.updateAsync(
      { userId, sha },
      { $set: { files: fileNamesOf(detail.files).slice(0, MAX_COMMIT_FILES), candidates, deepRankedAt: now } }
    );
    return { candidates };
  }
});
