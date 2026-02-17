import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './QuickActions.css';

export const QuickActions = ({ onNewProject, onNewSession }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleAction = (fn) => {
    fn();
    setOpen(false);
  };

  const isMac = navigator.platform?.toUpperCase().includes('MAC');
  const mod = isMac ? '\u2318' : 'Ctrl+';

  return (
    <span className="quickActions" ref={ref}>
      <button
        className="quickActions-btn"
        onClick={() => setOpen(o => !o)}
        title="Quick actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {open && (
        <div className="quickActions-dropdown">
          <button className="quickActions-item" onClick={() => handleAction(onNewProject)}>
            <span className="quickActions-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="quickActions-label">New Project</span>
          </button>
          <button className="quickActions-item" onClick={() => handleAction(onNewSession)}>
            <span className="quickActions-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </span>
            <span className="quickActions-label">New Note Session</span>
            <kbd className="quickActions-kbd">{mod}N</kbd>
          </button>
          <div className="quickActions-divider" />
          <div className="quickActions-hint">
            <kbd className="quickActions-kbd">{mod}K</kbd>
            <span>search</span>
          </div>
          <div className="quickActions-hint">
            <kbd className="quickActions-kbd">{mod}G</kbd>
            <span>all screens & actions</span>
          </div>
        </div>
      )}
    </span>
  );
};

QuickActions.propTypes = {
  onNewProject: PropTypes.func.isRequired,
  onNewSession: PropTypes.func.isRequired,
};
