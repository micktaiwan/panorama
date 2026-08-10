import fs from 'fs';
import net from 'net';
import path from 'path';
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

// Imported so the trigger file is part of the server bundle, hence part of the
// dev watch set (with a mainModule, unimported files are not watched).
import './devRestartTrigger.js';

// --- Post-sleep MongoDB recovery watchdog ---
//
// Problem: when the laptop sleeps, the TCP/TLS connection to the remote MongoDB
// (replica set rs0 on the VPS) dies. On wake the driver often gets wedged:
// server selection fails (ENETUNREACH / ReplicaSetNoPrimary), and the Meteor
// change-stream layer churns restarts from a now-stale resume token without ever
// recovering — so the app stays blank until a manual process restart.
//
// The change-stream restart logic lives inside the Meteor `mongo` package
// (shared_change_stream.js), out of our reach. The only reliable recovery we can
// drive from app code is what we do by hand today: once the network is back,
// restart the process so every stale socket / cursor / resume token is dropped
// and rebuilt fresh.
//
// How the restart happens depends on the environment:
// - Production (VPS): process.exit(0); the docker restart policy relaunches.
// - Development: `meteor run` does NOT relaunch an exited process — any exit,
//   even code 0, prints "Your application is crashing. Waiting for file change."
//   and waits (meteor-tool run-app.js, outcome 'terminated'). So instead we
//   rewrite devRestartTrigger.js: the file watcher sees the hash change and
//   Meteor rebuilds + relaunches the server itself.
//
// This watchdog detects wake via clock drift (a timer that should fire every
// TICK_MS but fires much later means the machine slept), then restarts only if
// the Mongo connection actually dropped. A wake where Mongo survived does
// nothing, so normal use is never disturbed. On the VPS (no sleep) it never fires.

const TICK_MS = 5000;             // heartbeat cadence
const WAKE_DRIFT_MS = 20000;      // extra gap beyond TICK_MS that means "the machine slept"
const PROBE_TIMEOUT_MS = 8000;    // bound a single ping so it can't hang for serverSelectionTimeoutMS
const RECOVERY_RETRY_MS = 5000;   // re-probe cadence while waiting for the network to return
const WAIT_LOG_EVERY_MS = 60000;  // how often to report that we are still waiting for Mongo
const STABLE_PROBES = 3;          // consecutive good probes required before restarting
const EXIT_CODE = 0;              // clean restart; relaunched by the docker restart policy (production)
const DEV_EXIT_FALLBACK_MS = 10000; // dev: exit anyway if the watcher restart didn't kill us by then

// Ping the remote Mongo with a hard timeout so the probe itself never hangs.
async function pingMongo() {
  let timer;
  try {
    const { client } = MongoInternals.defaultRemoteCollectionDriver().mongo;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('ping timeout')), PROBE_TIMEOUT_MS);
    });
    await Promise.race([client.db('admin').command({ ping: 1 }), timeout]);
    return true;
  } catch (_e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Host:port of the Mongo server, read from MONGO_URL (first host of the list).
// `mongodb+srv://` URLs carry no port and need an SRV lookup, so they get no endpoint.
function mongoEndpoint() {
  const match = /^mongodb:\/\/(?:[^@/]*@)?([^/?,]+)/.exec(process.env.MONGO_URL || '');
  if (!match) return null;
  const [host, port] = match[1].split(':');
  if (!host) return null;
  return { host, port: Number(port) || 27017 };
}

// Can we open a TCP connection to the Mongo host? Unlike pingMongo this does not
// go through the driver, so it still answers once the driver client is closed for
// good ("Topology is closed") — which is exactly the state we recover from.
function probeNetwork() {
  const endpoint = mongoEndpoint();
  if (!endpoint) return pingMongo(); // no parsable endpoint: fall back to the driver
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

// Rewrite the dev restart trigger so the Meteor file watcher relaunches us.
// Returns false when not running under the meteor tool or the write failed.
function touchDevRestartTrigger() {
  // METEOR_SHELL_DIR is <app>/.meteor/local/shell, set by the meteor tool in dev.
  const shellDir = process.env.METEOR_SHELL_DIR;
  if (!shellDir) return false;
  const trigger = path.resolve(shellDir, '..', '..', '..', 'server', 'devRestartTrigger.js');
  try {
    const base = fs.readFileSync(trigger, 'utf8')
      .replace(/\/\/ last wake-recovery restart:.*\n?/g, '')
      .trimEnd();
    fs.writeFileSync(trigger, `${base}\n// last wake-recovery restart: ${new Date().toISOString()}\n`);
    return true;
  } catch (e) {
    console.error(`[wake-recovery] failed to rewrite dev restart trigger at ${trigger}:`, e);
    return false;
  }
}

function restart(reason) {
  console.warn(`[wake-recovery] restarting server to recover Mongo state: ${reason}`);
  if (Meteor.isDevelopment && touchDevRestartTrigger()) {
    console.log('[wake-recovery] dev restart trigger rewritten — waiting for Meteor to relaunch us.');
    // Normally the watcher kills this process within seconds. If it somehow
    // missed the event, exit anyway: the post-exit watcher compares hashes
    // against the last bundle, sees the trigger changed, and rebuilds.
    setTimeout(() => process.exit(EXIT_CODE), DEV_EXIT_FALLBACK_MS);
    return;
  }
  // Production: let the log flush, then exit; the docker restart policy relaunches.
  setTimeout(() => process.exit(EXIT_CODE), 250);
}

let recovering = false;

// Wait for the network to come back, then restart. Idempotent: the first caller
// wins, later ones are no-ops.
//
// Waiting is not optional: restarting while Mongo is still unreachable buys
// nothing and actively hurts. The fresh process runs its startup index creation
// against a closed topology, throws, and exits 1 — which under `meteor run` is
// terminal ("Your application is crashing. Waiting for file change."), so the app
// stays dead until a human touches a file. Seen on 2026-07-29 after four
// consecutive sleeps, and again on 2026-08-10 when Wi-Fi went back down during
// the rebuild that followed a restart.
//
// Hence STABLE_PROBES: one lucky packet on a half-associated Wi-Fi link is not a
// working network. We require several consecutive good probes so the link has
// been up for ~15s before we spend a restart on it.
export function waitForMongoThenRestart(reason) {
  if (recovering) return;
  recovering = true;
  console.warn(`[wake-recovery] ${reason} — waiting for the network, will restart once Mongo answers.`);
  const startedAt = Date.now();
  let probing = false;
  let lastLoggedAt = Date.now();
  let goodProbes = 0;
  const wait = setInterval(async () => {
    if (probing) return; // don't overlap probes if one runs long
    probing = true;
    try {
      if (await probeNetwork()) {
        goodProbes += 1;
        if (goodProbes >= STABLE_PROBES) {
          clearInterval(wait);
          restart(reason);
        }
        return;
      }
      goodProbes = 0; // the link flapped: start the stability count over
      if (Date.now() - lastLoggedAt >= WAIT_LOG_EVERY_MS) {
        lastLoggedAt = Date.now();
        const waitedS = Math.round((Date.now() - startedAt) / 1000);
        console.warn(`[wake-recovery] Mongo still unreachable after ${waitedS}s — still waiting, will restart once it answers.`);
      }
    } finally {
      probing = false;
    }
  }, RECOVERY_RETRY_MS);
}

async function onWake(sleptMs) {
  if (recovering) return;
  console.warn(`[wake-recovery] wake detected (slept ~${Math.round(sleptMs / 1000)}s), probing Mongo…`);
  if (await pingMongo()) {
    console.log('[wake-recovery] Mongo still reachable after wake — no action.');
    return;
  }
  // The connection dropped across the sleep: the change-stream layer is almost
  // certainly wedged. Wait for the network to come back, then restart clean.
  waitForMongoThenRestart('Mongo unreachable after wake');
}

Meteor.startup(() => {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const drift = now - last - TICK_MS; // >0 means the timer fired late
    last = now;
    if (drift > WAKE_DRIFT_MS) {
      onWake(drift + TICK_MS).catch((e) => console.error('[wake-recovery] onWake failed:', e));
    }
  }, TICK_MS);
  console.log('[wake-recovery] watchdog armed.');
});
