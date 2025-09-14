import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { playBeep } from '../../utils/sound.js';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '', leftPanel = null, stacked = false }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldUseInApp, setShouldUseInApp] = useState(true);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Decide routing once on mount: always show in-app; also send native if window unfocused
  useEffect(() => {
    const isFocused = typeof document !== 'undefined' && document.hasFocus();
    const canNative = typeof window !== 'undefined' && window.electron && typeof window.electron.notify === 'function';
    setShouldUseInApp(true);
    if (!isFocused && canNative) {
      window.electron.notify({ title: 'Panorama', body: message });
    }
  }, [message, onClose]);

  // Play sound once on mount for in-app toasts
  useEffect(() => {
    if (shouldUseInApp) {
      playBeep(kind === 'error' ? 0.6 : 0.4);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shouldUseInApp) return undefined;
    if (durationMs > 0) {
      const t = setTimeout(() => {
        setIsClosing(true);
        const t2 = setTimeout(() => { onCloseRef.current?.(); }, 180);
        // Cleanup nested timeout if unmounted before it fires
        return () => clearTimeout(t2);
      }, durationMs);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [durationMs, shouldUseInApp]);

  if (!shouldUseInApp) return null;
  const classes = ['notify', kind, isClosing ? 'closing' : '', stacked ? 'stacked' : '', className].filter(Boolean).join(' ');
  // Icon contrasts with the colored aside background
  const kindToColor = {
    error: '#ffffff',
    success: '#ffffff',
    warning: '#ffffff',
    info: '#ffffff'
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
          <button className="iconButton ml8" aria-label="Close" onClick={() => { setIsClosing(true); setTimeout(() => { onCloseRef.current?.(); }, 160); }}>✕</button>
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
