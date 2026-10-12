import { Meteor } from 'meteor/meteor';

// Recover from zombie DDP connections.
//
// After the machine sleeps or the network changes, the underlying websocket can
// die without either end noticing. Meteor's heartbeat is driven by timers that
// the browser suspends while the tab is backgrounded / the OS is asleep, so on
// wake it often fails to detect the dead socket: Meteor.status() keeps reporting
// { status: 'connected', connected: true } while every method call hangs forever
// (Save buttons stuck on "Saving...", lists stay on "Loading…"). Meteor never
// reconnects on its own because, as far as it knows, it is still connected.
//
// The fix: whenever the tab regains attention (becomes visible, window focus, or
// the browser fires `online`), actively probe the socket with a fast method call.
// If the probe does not answer within a short window, the connection is a zombie —
// tear it down and reconnect. Reconnecting re-sends every pending method call and
// re-runs subscriptions, so stuck saves complete instead of hanging forever.
//
// Attention events alone miss the case where the window is already focused and
// visible when things break (2026-10-12: Wi-Fi switch without sleep, Panorama page
// stuck loading for hours). So we also probe periodically while the tab is visible,
// and nudge Meteor when it sits in its reconnect backoff.
//
// The periodic probe uses a much longer timeout than the attention probe: ddp.ping
// is queued behind any method of the session that did not call unblock(), so a
// legitimately slow method would otherwise trigger a reconnect, and a reconnect
// re-sends that method (it would run twice).
//
// Ported from mystreams (imports/ui/ddpKeepAlive.js); documented in
// self/files/vps-ovh.md (section "Connexion DDP zombie après veille").

const PROBE_TIMEOUT_MS = 4000;
const MIN_INTERVAL_MS = 3000; // don't probe more than once every few seconds
const PERIODIC_EVERY_MS = 60000;
const PERIODIC_PROBE_TIMEOUT_MS = 30000;

let probing = false;
let lastProbe = 0;

async function ensureLive(timeoutMs = PROBE_TIMEOUT_MS) {
  if (probing) return;
  const now = Date.now();
  if (now - lastProbe < MIN_INTERVAL_MS) return;
  lastProbe = now;

  const { status } = Meteor.status();
  // Meteor waits in an exponential backoff between retries ('waiting'). The server
  // is local, so there is no reason to wait: retry now.
  if (status === 'waiting') {
    console.warn('[ddpKeepAlive] DDP waiting to reconnect, retrying now');
    Meteor.reconnect();
    return;
  }
  // Otherwise only meaningful to probe when Meteor believes it is connected. If it
  // is connecting, its own retry logic is already at work.
  if (status !== 'connected') return;

  probing = true;
  try {
    const startedAt = Date.now();
    const alive = await Promise.race([
      Meteor.callAsync('ddp.ping').then(() => true).catch(() => true), // any reply = socket alive
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (!alive) {
      // Zombie: reported connected but nothing round-trips. Force a fresh socket.
      console.warn(`[ddpKeepAlive] no answer to ddp.ping after ${timeoutMs} ms (zombie socket or session queue blocked), forcing disconnect + reconnect`);
      Meteor.disconnect();
      Meteor.reconnect();
    } else if (Date.now() - startedAt > PROBE_TIMEOUT_MS) {
      console.warn(`[ddpKeepAlive] ddp.ping took ${Date.now() - startedAt} ms (session queue busy)`);
    }
  } finally {
    probing = false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureLive();
  });
  window.addEventListener('focus', () => ensureLive());
  window.addEventListener('online', () => ensureLive());
  // Page Lifecycle API: Chromium can freeze a hidden tab entirely; on unfreeze
  // it fires `resume` without a visibilitychange, so probe on it too.
  document.addEventListener('resume', () => ensureLive());
  setInterval(() => {
    if (document.visibilityState === 'visible') ensureLive(PERIODIC_PROBE_TIMEOUT_MS);
  }, PERIODIC_EVERY_MS);
}
