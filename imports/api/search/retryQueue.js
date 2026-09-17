import { Mongo } from 'meteor/mongo';

// Durable retry queue for search index writes.
//
// Index writes run after the source document is saved, so a transient Qdrant or
// embedding failure (tunnel drop, "other side closed") used to leave the document
// missing or stale in the index until the next edit. Every failed write lands here
// and retryWorker.js replays it with backoff.
//
// One entry per logical document (_id = "<kind>:<id>"): a newer failure replaces an
// older one, a newer success removes it.
export const SearchIndexRetriesCollection = new Mongo.Collection('searchIndexRetries');

export const retryKey = (kind, id) => `${String(kind)}:${String(id)}`;

// A write that fails can finish after a newer write for the same document already
// succeeded (index calls are fire-and-forget, e.g. note autosave). Queuing the older
// payload would then overwrite fresh content on replay. Remember recent successes
// per key so a late failure from an older call is dropped. Entries only need to
// outlive one call (Qdrant timeout is 15s), so the map is pruned past that.
const SUCCESS_MEMORY_MS = 5 * 60 * 1000;
const recentSuccessStart = new Map();

const pruneSuccessMemory = (now) => {
  for (const [key, startedAt] of recentSuccessStart) {
    if (now - startedAt > SUCCESS_MEMORY_MS) recentSuccessStart.delete(key);
  }
};

export const recordIndexSuccess = async (key, startedAt) => {
  const now = Date.now();
  pruneSuccessMemory(now);
  const previous = recentSuccessStart.get(key) ?? 0;
  if (startedAt > previous) recentSuccessStart.set(key, startedAt);
  // Only drop an entry queued by an older call; a failure from a newer call stays.
  await SearchIndexRetriesCollection.removeAsync({ _id: key, requestedAt: { $lte: new Date(startedAt) } });
};

export const enqueueIndexRetry = async ({ key, op, args, userId = null, startedAt, error }) => {
  if ((recentSuccessStart.get(key) ?? 0) > startedAt) return;
  const now = new Date();
  const requestedAt = new Date(startedAt);
  const set = {
    op,
    args,
    userId,
    requestedAt,
    attempts: 0,
    nextAttemptAt: now,
    lastError: String(error?.message || error).slice(0, 500),
    updatedAt: now,
  };
  const existing = await SearchIndexRetriesCollection.findOneAsync({ _id: key }, { fields: { requestedAt: 1 } });
  if (!existing) {
    await SearchIndexRetriesCollection.rawCollection()
      .insertOne({ _id: key, ...set, createdAt: now })
      .catch(async (e) => {
        // Concurrent insert for the same key: fall through to the conditional update
        if (e?.code !== 11000) throw e;
        await SearchIndexRetriesCollection.updateAsync({ _id: key, requestedAt: { $lte: requestedAt } }, { $set: set });
      });
    return;
  }
  await SearchIndexRetriesCollection.updateAsync({ _id: key, requestedAt: { $lte: requestedAt } }, { $set: set });
};

// Bulk deletes (by project, session, kind) make any pending write for those documents moot.
export const dropIndexRetries = async (selector) => {
  await SearchIndexRetriesCollection.removeAsync(selector);
};
