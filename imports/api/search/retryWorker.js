import { Meteor } from 'meteor/meteor';
import { SearchIndexRetriesCollection } from './retryQueue';
import { upsertDocNow, upsertDocChunksNow, deleteDocNow, deleteByDocIdNow } from './vectorStore';

// Replays index writes queued by vectorStore.js after a failure (see retryQueue.js).
//
// Both instances (local Electron and VPS) share the database and run this worker, so
// each entry is claimed atomically with a lease before being replayed.

const TICK_MS = 60 * 1000;
const BATCH_PER_TICK = 20;
const LEASE_MS = 5 * 60 * 1000;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;
// Past this many failed replays the problem is unlikely to be transient: log it once
// so it reaches the errors collection, but keep retrying hourly.
const REPORT_AFTER_ATTEMPTS = 5;

const RUNNERS = {
  upsert: (args) => upsertDocNow(args),
  upsertChunks: (args) => upsertDocChunksNow(args),
  delete: (args) => deleteDocNow(args.kind, args.id),
  deleteByDocId: (args) => deleteByDocIdNow(args.kind, args.id),
};

const claimNext = async () => {
  const now = new Date();
  const res = await SearchIndexRetriesCollection.rawCollection().findOneAndUpdate(
    { nextAttemptAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' }
  );
  // Driver 6 returns the document itself; older drivers wrap it in { value }
  return res?.value !== undefined ? res.value : res;
};

const replay = async (entry) => {
  const run = RUNNERS[entry.op];
  // Guard on requestedAt: a newer failure may have replaced the entry while it ran.
  const sameEntry = { _id: entry._id, requestedAt: entry.requestedAt };
  if (!run) {
    console.error('[search][retry] unknown op, dropping entry', entry._id, entry.op);
    await SearchIndexRetriesCollection.removeAsync(sameEntry);
    return;
  }
  try {
    await run(entry.args);
  } catch (e) {
    const attempts = (entry.attempts ?? 0) + 1;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempts - 1));
    await SearchIndexRetriesCollection.updateAsync(sameEntry, {
      $set: {
        attempts,
        nextAttemptAt: new Date(Date.now() + delay),
        lockedUntil: null,
        lastError: String(e?.message || e).slice(0, 500),
        updatedAt: new Date(),
      },
    });
    if (attempts === REPORT_AFTER_ATTEMPTS) {
      console.error(`[search][retry] ${entry.op} ${entry._id} still failing after ${attempts} retries`, e);
    }
    return;
  }
  await SearchIndexRetriesCollection.removeAsync(sameEntry);
};

let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < BATCH_PER_TICK; i += 1) {
      const entry = await claimNext();
      if (!entry) break;
      await replay(entry);
    }
  } catch (e) {
    console.error('[search][retry] worker tick failed', e);
  } finally {
    running = false;
  }
};

if (Meteor.isServer && !Meteor.isTest && !Meteor.isAppTest) {
  Meteor.startup(() => {
    SearchIndexRetriesCollection.rawCollection().createIndex({ nextAttemptAt: 1 }).catch((e) => console.error('[search][retry] index creation failed', e));
    SearchIndexRetriesCollection.rawCollection().createIndex({ userId: 1 }).catch((e) => console.error('[search][retry] index creation failed', e));
    Meteor.setInterval(tick, TICK_MS);
  });
}
