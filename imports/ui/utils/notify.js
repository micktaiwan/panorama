let handler = null;

export const setNotifyHandler = (fn) => {
  handler = typeof fn === 'function' ? fn : null;
};

export const notify = ({ message, kind = 'info', durationMs } = {}) => {
  console.log(`[notify] ${kind}: ${message}`);
  if (handler) {
    handler({ message, kind, durationMs });
  }
};
