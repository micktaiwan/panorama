import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { playBeep } from '../../utils/sound.js';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '' }) => {
  const [visible, setVisible] = useState(true);
  const [shouldUseInApp, setShouldUseInApp] = useState(true);

  // Decide routing once on mount: in-app if focused, native if unfocused
  useEffect(() => {
    const isFocused = typeof document !== 'undefined' && document.hasFocus();
    const canNative = typeof window !== 'undefined' && window.electron && typeof window.electron.notify === 'function';
    if (!isFocused && canNative) {
      setShouldUseInApp(false);
      window.electron.notify({ title: 'Panorama', body: message });
      onClose?.();
    } else {
      setShouldUseInApp(true);
    }
  }, [message, onClose]);

  // Play sound only for in-app toasts
  useEffect(() => {
    if (visible && shouldUseInApp) {
      playBeep(kind === 'error' ? 0.6 : 0.4);
    }
  }, [visible, kind, shouldUseInApp]);

  useEffect(() => {
    if (!shouldUseInApp) return;
    if (durationMs > 0) {
      const t = setTimeout(() => { setVisible(false); onClose?.(); }, durationMs);
      return () => clearTimeout(t);
    }
  }, [durationMs, onClose, shouldUseInApp]);

  if (!visible || !shouldUseInApp) return null;
  const classes = ['notify', kind, className].filter(Boolean).join(' ');
  return (
    <output className={classes} aria-live="polite">
      {message}
      <button className="iconButton ml8" aria-label="Close" onClick={() => { setVisible(false); onClose?.(); }}>✕</button>
    </output>
  );
};

Notify.propTypes = {
  message: PropTypes.string.isRequired,
  kind: PropTypes.oneOf(['info', 'success', 'warning', 'error']),
  onClose: PropTypes.func,
  durationMs: PropTypes.number,
  className: PropTypes.string
};
