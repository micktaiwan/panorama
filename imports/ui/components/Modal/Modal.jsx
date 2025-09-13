import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import './Modal.css';

export const Modal = ({ open, onClose, title, children, actions, className = '', icon = null, panelClassName = '', leftPanel = null, closable = true }) => {
  const overlayRef = useRef(null);
  const titleIdRef = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);

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

  const overlayClassName = className ? 'modalOverlay ' + className : 'modalOverlay';
  const panelClass = panelClassName ? 'modalPanel ' + panelClassName : 'modalPanel';
  const overlay = (
    <div
      className={overlayClassName}
      ref={overlayRef}
    >
      <button type="button" className="modalBackdrop" aria-label="Close modal" onClick={() => onClose?.()} />
      <dialog className={panelClass} open aria-modal="true" aria-labelledby={title ? titleIdRef.current : undefined}>
        {title ? (
          <div className="modalHeader">
            {renderIcon ? <div className="modalIcon" aria-hidden="true">{renderIcon}</div> : null}
            <div id={titleIdRef.current} className="modalTitle">{title}</div>
            {closable ? (
              <button className="iconButton" aria-label="Close" onClick={onClose}>✕</button>
            ) : null}
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
      </dialog>
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
  closable: PropTypes.bool,
};

