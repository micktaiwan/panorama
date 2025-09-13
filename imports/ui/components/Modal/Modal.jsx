import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import './Modal.css';

export const Modal = ({ open, onClose, title, children, actions, className = '', icon = null, panelClassName = '', leftPanel = null }) => {
  const overlayRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const defaultIcon = '★';
  const renderIcon = icon === false ? null : (icon || defaultIcon);

  const overlay = (
    <div className={`modalOverlay${className ? ` ${className}` : ''}`} ref={overlayRef} onClick={(e) => {
      if (e.target === overlayRef.current) onClose?.();
    }}>
      <div className={`modalPanel${panelClassName ? ` ${panelClassName}` : ''}`} role="dialog" aria-modal="true">
        {title ? (
          <div className="modalHeader">
            {renderIcon ? <div className="modalIcon" aria-hidden="true">{renderIcon}</div> : null}
            <div className="modalTitle">{title}</div>
            <button className="iconButton" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        ) : null}
        {leftPanel ? (
          <div className="modalBody split">
            <div className="modalSplit">
              <aside className="modalAside">
                {typeof leftPanel === 'string' ? (<img src={leftPanel} alt="" />) : leftPanel}
              </aside>
              <main className="modalMain">{children}</main>
            </div>
          </div>
        ) : (
          <div className="modalBody">{children}</div>
        )}
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

Modal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func,
  title: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  children: PropTypes.node,
  actions: PropTypes.arrayOf(PropTypes.node),
  className: PropTypes.string,
  icon: PropTypes.oneOfType([PropTypes.string, PropTypes.node, PropTypes.bool]),
  panelClassName: PropTypes.string,
  leftPanel: PropTypes.oneOfType([PropTypes.node, PropTypes.string]),
};

