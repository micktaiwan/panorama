import React, { useRef, useEffect } from 'react';
import './CommandPopup.css';

export const CommandPopup = ({ commands, activeIdx, onSelect }) => {
  const listRef = useRef(null);

  useEffect(() => {
    const active = listRef.current?.children[activeIdx];
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!commands.length) return null;

  return (
    <div className="ccCommandPopup">
      <ul ref={listRef} className="ccCommandList">
        {commands.map((cmd, i) => (
          <li
            key={cmd.name}
            className={`ccCommandItem ${i === activeIdx ? 'ccCommandItemActive' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
          >
            <span className="ccCommandName">/{cmd.name}</span>
            <span className="ccCommandDesc">{cmd.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
