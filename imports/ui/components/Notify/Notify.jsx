import React, { useEffect, useState } from 'react';
import './Notify.css';

export const Notify = ({ message, kind = 'info', onClose, durationMs = 3000, className = '' }) => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (durationMs > 0) {
      const t = setTimeout(() => { setVisible(false); onClose && onClose(); }, durationMs);
      return () => clearTimeout(t);
    }
  }, [durationMs, onClose]);
  if (!visible) return null;
  return (
    <div className={`notify ${kind}${className ? ` ${className}` : ''}`} role="status">
      {message}
      <button className="iconButton ml8" aria-label="Close" onClick={() => { setVisible(false); onClose && onClose(); }}>✕</button>
    </div>
  );
};


