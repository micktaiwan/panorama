import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { playBeep } from '../../utils/sound.js';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '', leftPanel = null }) => {
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
  const defaultSvg = (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <defs>
        <linearGradient id="notifyGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={kind === 'error' ? '#ef4444' : kind === 'success' ? '#22c55e' : '#4f46e5'} />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="72" height="72" rx="12" fill="#0b1020" stroke="rgba(255,255,255,0.08)" />
      <g fill="none" stroke="url(#notifyGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'error' ? (
          <g>
            <line x1="22" y1="22" x2="50" y2="50" />
            <line x1="50" y1="22" x2="22" y2="50" />
          </g>
        ) : kind === 'success' ? (
          <polyline points="20,36 30,46 52,24" />
        ) : kind === 'warning' ? (
          <g>
            <polygon points="36,16 60,56 12,56" fill="none" />
            <line x1="36" y1="28" x2="36" y2="42" />
            <circle cx="36" cy="50" r="2" />
          </g>
        ) : (
          <g>
            <circle cx="30" cy="30" r="10" />
            <line x1="38" y1="38" x2="50" y2="50" />
          </g>
        )}
      </g>
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
  leftPanel: PropTypes.oneOfType([PropTypes.node, PropTypes.string, PropTypes.bool])
};
