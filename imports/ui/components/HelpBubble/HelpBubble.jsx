import React, { useEffect, useRef, useState } from 'react';
import { Help } from '/imports/ui/Help/Help.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import './HelpBubble.css';

export default function HelpBubble() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      const key = String(e.key || '').toLowerCase();
      if (e.metaKey && key === 'h') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`HelpBubble__root${open ? ' isOpen' : ''}`}>
      <Tooltip content={open ? 'Close help' : 'Open help'}>
        <button className="HelpBubble__fab" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Close help' : 'Open help'} aria-expanded={open} aria-haspopup="dialog">❔</button>
      </Tooltip>
      {open && (
        <div className="HelpBubble__panel" ref={panelRef} role="dialog" aria-label="Help">
          <div className="HelpBubble__header">
            <div className="HelpBubble__title">Help</div>
            <button className="HelpBubble__close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="HelpBubble__content">
            <Help />
          </div>
        </div>
      )}
    </div>
  );
}


