import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { playBeep } from '../../utils/sound.js';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '', leftPanel = null, stacked = false }) => {
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
  const classes = ['notify', kind, stacked ? 'stacked' : '', className].filter(Boolean).join(' ');
  const kindToColor = {
    error: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
    info: 'var(--primary)'
  };
  const iconColor = kindToColor[kind] || 'var(--primary)';
  const defaultSvg = (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" style={{ color: iconColor }}>
      <path d="M12 2c-1.7 0-3 1.3-3 3v1.1C6 6.8 4 9.5 4 12.7V15l-1.6 1.6c-.45.45-.13 1.4.55 1.4h18.1c.68 0 1-.95.55-1.4L20 15v-2.3c0-3.2-2-5.9-5-6.6V5c0-1.7-1.3-3-3-3z" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );

  return (
    <output className={classes} aria-live="polite">
      <div className="notifySplit">
        <aside className="notifyAside">
          {leftPanel === false ? null : (leftPanel || defaultSvg)}
        </aside>
        <div className="notifyMain">
          <span>{message}</span>
          <button className="iconButton ml8" aria-label="Close" onClick={() => { setVisible(false); onClose?.(); }}>✕</button>
        </div>
      </div>
    </output>
  );
};

Notify.propTypes = {
  message: PropTypes.string.isRequired,
  kind: PropTypes.oneOf(['info', 'success', 'warning', 'error']),
  onClose: PropTypes.func,
  durationMs: PropTypes.number,
  className: PropTypes.string,
  leftPanel: PropTypes.oneOfType([PropTypes.node, PropTypes.string, PropTypes.bool]),
  stacked: PropTypes.bool
};
