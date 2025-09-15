import { notify } from '/imports/ui/utils/notify.js';

export const writeClipboard = (text) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    notify({ message: 'Copy failed: Clipboard API unavailable', kind: 'error' });
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(text)
    .then(() => {
      notify({ message: 'Copied!', kind: 'success' });
      return true;
    })
    .catch((err) => {
      console.error('Clipboard write failed', err);
      notify({ message: `Copy failed: ${err?.message || 'Unknown error'}`, kind: 'error' });
      return false;
    });
};
