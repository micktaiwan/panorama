import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';
import { getGithubConfigAsync } from '/imports/api/_shared/config';
import { PeopleCollection } from '/imports/api/people/collections';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { StaffingCollection } from './collections';
import { CommitsCollection, BranchClassificationsCollection, OpportunitySuggestionsCollection } from './gitCollections';
import { fetchRepoMeta, fetchBranchCommits } from './githubClient';
import { resolveGithubToken } from './githubAppAuth';
import { rankCommitsBatch, suggestProjectKeywords } from './classifier';

// How many commits we send to the LLM per ranking call (internal batching).
// Kept small so a single call stays well under the LLM timeout.
const RANK_BATCH = 8;

// Conventional-commit scope: "type(scope): subject" -> scope; "type: subject" -> type.
// Strips a leading "N - " / "N " stacking prefix used in the lempire repo.
const scopeOf = (msg) => {
  const t = String(msg || '').replace(/^\s*\d+\s*-?\s*/, '').trim();
  const m = t.match(/^(\w+)(?:\(([^)]+)\))?!?:/);
  return m ? (m[2] || m[1] || 'autre').toLowerCase() : 'autre';
};

// Live progress of the running analysis, keyed by userId, polled by the client.
const analysisProgress = new Map();

/**
 * Resolve a commit author to a person owned by userId.
 * Match priority: githubUsername (login) > email.
 */
const buildAuthorResolver = (people) => {
  const byLogin = new Map();
  const byEmail = new Map();
  people.forEach(p => {
    if (p.githubUsername) byLogin.set(p.githubUsername.toLowerCase(), p._id);
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
        PeopleCollection.find({ userId }, { fields: { githubUsername: 1, email: 1 } }).fetchAsync(),
        OpportunitiesCollection.find({ userId }, { fields: { name: 1, keywords: 1 } }).fetchAsync()
      ]);
      const resolveAuthor = buildAuthorResolver(people);

      const commits = await fetchBranchCommits(cfg.repo, token, { branch: defaultBranch, since, max: 1000 });

      // Ingest. `scope` is kept only as a display hint — it no longer drives classification.
      let commitsIngested = 0;
      const unresolvedAuthors = new Set();
      const now = new Date();
      const toRank = []; // { sha, message } with the FULL message for the LLM
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
        toRank.push({ sha: c.sha, message: c.message || '' });
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
    const startedAt = Date.now();
    analysisProgress.set(userId, { phase: 'ranking', current: 0, total: 0, startedAt });
    try {
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
    } catch (err) {
      console.error('[staffing.rerankUnclassified] failed:', err?.reason || err?.message || err, err?.stack || '');
      throw err;
    } finally {
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
  }
});
