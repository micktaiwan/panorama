let handler = null;

/**
 * Register the single global toast sink.
 * Only NotifyProvider (mounted once, at the App root) may call this: a second
 * caller would silently steal every toast, and setting it back to null on its
 * unmount would leave the app with no sink at all.
 */
export const setNotifyHandler = (fn) => {
  handler = typeof fn === 'function' ? fn : null;
};

export const notify = ({ message, kind = 'info', durationMs, action } = {}) => {
  console.log(`[notify] ${kind}: ${message}`);
  if (handler) {
    handler({ message, kind, durationMs, action });
  }
};
