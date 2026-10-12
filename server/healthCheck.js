import os from 'os';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { WebApp } from 'meteor/webapp';

// GET /healthz — a real Mongo round-trip for the start-local.sh watchdog.
//
// The watchdog used to curl the home page only: a server that serves its HTML but
// whose Mongo path is wedged looked healthy. On 2026-10-12 the Wi-Fi switched
// networks twice without the Mac sleeping, the SSH tunnel to Mongo was replaced,
// and the Panorama page then stayed on its loading bar for hours while the
// watchdog saw nothing.
//
// The check writes a heartbeat document and waits until the server's own
// observer sees it. That covers what a plain `ping` would miss: a write that
// never returns, and a change stream that no longer delivers events (the state
// wakeRecovery.js restarts the process for after a sleep).
//
// Development only: on the VPS this route would be public and every hit is a write.

// Internal collection, never published and not user data: no userId by design.
const HealthBeatsCollection = new Mongo.Collection('healthBeats');
const BEAT_ID = `${os.hostname()}:${process.pid}`;
const ROUNDTRIP_TIMEOUT_MS = 10000;

const waiters = new Set();
let observerPromise = null;
// The watchdog polls every 15 s: log state changes only, not every failed probe
// (a night offline would otherwise fill the errors collection).
let failing = false;

function notify(fields) {
  const seen = fields?.at ? new Date(fields.at).getTime() : 0;
  for (const waiter of waiters) {
    if (seen >= waiter.at) {
      waiters.delete(waiter);
      waiter.resolve();
    }
  }
}

// Started once and kept for the life of the process. If starting it hangs, every
// later check awaits the same promise and times out, which is the signal we want.
function ensureObserver() {
  if (!observerPromise) {
    observerPromise = HealthBeatsCollection.find({ _id: BEAT_ID }).observeChangesAsync({
      added: (_id, fields) => notify(fields),
      changed: (_id, fields) => notify(fields),
    });
  }
  return observerPromise;
}

async function roundTrip() {
  const startedAt = Date.now();
  let waiter;
  let timer;
  let settled = false;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no Mongo round-trip after ${ROUNDTRIP_TIMEOUT_MS} ms`)), ROUNDTRIP_TIMEOUT_MS);
    });
    const work = (async () => {
      await ensureObserver();
      const at = new Date();
      const seen = new Promise((resolve) => {
        waiter = { at: at.getTime(), resolve };
        waiters.add(waiter);
      });
      await HealthBeatsCollection.upsertAsync({ _id: BEAT_ID }, { $set: { at } });
      await seen;
    })();
    // A write that fails after the timeout (503 already sent) must not surface as
    // an unhandledRejection, which server/main.js may turn into an exit. Failures
    // inside the window are reported by the caller; late ones are logged here.
    work.catch((error) => {
      if (settled) console.warn(`[healthz] round-trip failed after the timeout: ${error?.message || error}`);
    });
    await Promise.race([work, timeout]);
    return { ok: true, ms: Date.now() - startedAt };
  } finally {
    settled = true;
    clearTimeout(timer);
    if (waiter) waiters.delete(waiter);
  }
}

if (Meteor.isDevelopment) {
  WebApp.connectHandlers.use('/healthz', async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const result = await roundTrip();
      if (failing) {
        failing = false;
        console.warn(`[healthz] Mongo round-trip OK again (${result.ms} ms)`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      if (!failing) {
        failing = true;
        console.error('[healthz] Mongo round-trip failed:', error?.message || error);
      }
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
    }
  });
}
