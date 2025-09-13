let handler = null;

export const setNotifyHandler = (fn) => {
  handler = typeof fn === 'function' ? fn : null;
};

export const notify = ({ message, kind = 'info', durationMs } = {}) => {
  if (handler) {
    handler({ message, kind, durationMs });
  } else {
    console.log(`[notify] ${kind}: ${message}`);
  }
};
