import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';
import { SearchQualityRunsCollection } from './collections';
import { startRun } from './runner';

const LIST_FIELDS = {
  userId: 1, source: 1, status: 1, startedAt: 1, finishedAt: 1, durationMs: 1,
  params: 1, env: 1, summary: 1, recommendationsSummary: 1, counts: 1, error: 1
};

Meteor.methods({
  // Start a run in the background and return its id right away.
  // Values are sanitized (clamped, filtered) by normalizeParams in the runner,
  // so the shape check stays loose on purpose.
  async 'searchQuality.start'(opts = {}) {
    ensureLoggedIn(this.userId);
    check(opts, Object);
    const source = opts?.source === 'mcp' ? 'mcp' : 'ui';
    return startRun({ userId: this.userId, source, opts });
  },

  // Full stored outcome of one run.
  async 'searchQuality.run'(runId) {
    check(runId, String);
    ensureLoggedIn(this.userId);
    return ensureOwner(SearchQualityRunsCollection, runId, this.userId);
  },

  // Recent runs, headline metrics only (no failure lists).
  async 'searchQuality.runs'(opts = {}) {
    ensureLoggedIn(this.userId);
    check(opts, Object);
    const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 10));
    return SearchQualityRunsCollection.find(
      { userId: this.userId },
      { sort: { startedAt: -1 }, limit, fields: LIST_FIELDS }
    ).fetchAsync();
  }
});
