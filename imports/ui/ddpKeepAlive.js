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
// Ported from mystreams (imports/ui/ddpKeepAlive.js); documented in
// self/files/vps-ovh.md (section "Connexion DDP zombie après veille").

const PROBE_TIMEOUT_MS = 4000;
const MIN_INTERVAL_MS = 3000; // don't probe more than once every few seconds

let probing = false;
let lastProbe = 0;

async function ensureLive() {
  if (probing) return;
  const now = Date.now();
  if (now - lastProbe < MIN_INTERVAL_MS) return;
  lastProbe = now;

  // Only meaningful to probe when Meteor believes it is connected. If it already
  // knows it is offline/connecting, its own retry logic will handle reconnection.
  if (Meteor.status().status !== 'connected') return;

  probing = true;
  try {
    const alive = await Promise.race([
      Meteor.callAsync('ddp.ping').then(() => true).catch(() => true), // any reply = socket alive
      new Promise((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS)),
    ]);
    if (!alive) {
      // Zombie: reported connected but nothing round-trips. Force a fresh socket.
      console.warn('[ddpKeepAlive] zombie connection detected — forcing disconnect + reconnect');
      Meteor.disconnect();
      Meteor.reconnect();
    }
  } finally {
    probing = false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureLive();
  });
  window.addEventListener('focus', ensureLive);
  window.addEventListener('online', ensureLive);
  // Page Lifecycle API: Chromium can freeze a hidden tab entirely; on unfreeze
  // it fires `resume` without a visibilitychange, so probe on it too.
  document.addEventListener('resume', ensureLive);
}
