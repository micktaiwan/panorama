import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { playBeep } from '../../utils/sound.js';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '' }) => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (visible) {
      playBeep(kind === 'error' ? 0.6 : 0.4);
    }
  }, [visible, kind]);
  useEffect(() => {
    if (durationMs > 0) {
      const t = setTimeout(() => { setVisible(false); onClose?.(); }, durationMs);
      return () => clearTimeout(t);
    }
  }, [durationMs, onClose]);
  if (!visible) return null;
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
