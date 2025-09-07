let handler = null;

export const setNotifyHandler = (fn) => {
  handler = typeof fn === 'function' ? fn : null;
};

export const notify = ({ message, kind = 'info' }) => {
  if (handler) {
    handler({ message, kind });
  } else {
    console.log(`[notify] ${kind}: ${message}`);
  }
};
