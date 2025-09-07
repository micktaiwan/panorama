import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

export const Modal = ({ open, onClose, title, children, actions, className = '', icon = null, panelClassName = '' }) => {
  const overlayRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const overlay = (
    <div className={`modalOverlay${className ? ` ${className}` : ''}`} ref={overlayRef} onClick={(e) => {
      if (e.target === overlayRef.current) onClose && onClose();
    }}>
      <div className={`modalPanel${panelClassName ? ` ${panelClassName}` : ''}`} role="dialog" aria-modal="true">
        {title ? (
          <div className="modalHeader">
            {icon ? <div className="modalIcon" aria-hidden="true">{icon}</div> : null}
            <div className="modalTitle">{title}</div>
            <button className="iconButton" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        ) : null}
        <div className="modalBody">{children}</div>
        {Array.isArray(actions) && actions.length > 0 ? (
          <div className="modalFooter">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};


