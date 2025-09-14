import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { notify } from '/imports/ui/utils/notify.js';
import { ErrorsCollection } from '/imports/api/errors/collections';

// Ensure we only attach handlers once per client session
if (typeof window !== 'undefined') {
  const FLAG = '__PANORAMA_GLOBAL_ERRORS_ATTACHED__';
  if (!window[FLAG]) {
    window[FLAG] = true;

    // Browser runtime errors
    window.addEventListener('error', (event) => {
      const raw = event?.error || event;
      const msg = event?.message || raw?.message || String(raw ?? 'Unknown error');
      notify({ message: `Client error: ${msg}`, kind: 'error', durationMs: 6000 });
    });

    // Unhandled Promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      const msg = (reason && (reason.reason || reason.message)) || String(reason ?? 'Unhandled rejection');
      notify({ message: `Client error: ${msg}`, kind: 'error', durationMs: 6000 });
    });

    // Patch Meteor.call to surface server method errors via Notify by default
    if (Meteor && typeof Meteor.call === 'function') {
      const originalCall = Meteor.call;
      Meteor.call = function patchedMeteorCall(...args) {
        const hasCb = args.length > 0 && typeof args[args.length - 1] === 'function';
        if (hasCb) {
          const userCb = args[args.length - 1];
          const wantsErrParam = Number.isFinite(userCb.length) && userCb.length >= 1;
          args[args.length - 1] = function wrappedCallback(err, result) {
            if (err && !wantsErrParam) {
              const message = err?.reason || err?.message || String(err);
              notify({ message, kind: 'error', durationMs: 6000 });
            }
            return userCb(err, result);
          };
        } else {
          // No callback provided: add one to surface potential errors
          args.push(function defaultErrorNotifyCallback(err) {
            if (err) {
              const message = err?.reason || err?.message || String(err ?? 'Unknown error');
              notify({ message, kind: 'error', durationMs: 6000 });
            }
          });
        }
        return originalCall.apply(this, args);
      };
    }

    // Subscribe to recent server errors and notify as they arrive
    try {
      const sub = Meteor.subscribe('errors.recent');
      const seen = new Set();
      const cursor = ErrorsCollection.find({ kind: 'server' }, { sort: { createdAt: -1 }, limit: 200 });
      cursor.observe({
        added(doc) {
          if (!doc || !doc._id) return;
          if (seen.has(doc._id)) return;
          seen.add(doc._id);
          const message = String(doc.message || 'Server error');
          notify({ message, kind: 'error', durationMs: 6000 });
        }
      });
      // Optional: mark existing as seen once subscription is ready
      Tracker.autorun((c) => {
        if (sub.ready()) {
          ErrorsCollection.find({ kind: 'server' }, { fields: { _id: 1 } }).forEach((d) => { if (d && d._id) seen.add(d._id); });
          c.stop();
        }
      });
    } catch (e) {
      // Best-effort only; avoid throwing in global setup
      console.warn('[globalErrors] server errors subscription failed', e);
    }
  }
}
