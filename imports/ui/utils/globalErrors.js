import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';

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
  }
}


