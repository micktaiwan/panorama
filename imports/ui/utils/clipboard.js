import { notify } from '/imports/ui/utils/notify.js';

export const writeClipboard = async (text) => {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
    notify({ message: 'Copied !', kind: 'success' });
    return true;
  } catch {
    notify({ message: 'Copy failed', kind: 'error' });
    return false;
  }
};
