import React, { useState, useId } from 'react';
import './Collapsible.css';

// Collapsible container with accessible header and caret
// Usage:
// <Collapsible title="Section title" defaultOpen>
//   <div>Content…</div>
// </Collapsible>
export const Collapsible = ({
  title,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  className = '',
  toggleTextOpen = 'Hide',
  toggleTextClosed = 'Show'
}) => {
  const isControlled = typeof controlledOpen === 'boolean';
  const [internalOpen, setInternalOpen] = useState(!!defaultOpen);
  const open = isControlled ? controlledOpen : internalOpen;
  const id = useId();

  const toggle = () => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    if (typeof onToggle === 'function') onToggle(next);
  };

  return (
    <div className={`collapsible ${open ? 'open' : 'closed'}${className ? ` ${className}` : ''}`}>
      <div className="collapsibleHeader" aria-expanded={open ? 'true' : 'false'} aria-controls={`collapsible-panel-${id}`}>
        {title ? <span className="collapsibleTitle">{title}</span> : null}
        <button
          type="button"
          className="collapsibleToggleBtn"
          onClick={toggle}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-controls={`collapsible-panel-${id}`}
          aria-expanded={open ? 'true' : 'false'}
        >
          {open ? toggleTextOpen : toggleTextClosed}
        </button>
      </div>
      <div id={`collapsible-panel-${id}`} className="collapsiblePanel" hidden={!open}>
        {children}
      </div>
    </div>
  );
};


