import { useEffect, useRef } from 'react';
import './CommandPopup.css';

interface Command {
  name: string;
  description: string;
  hasArgs?: boolean;
}

interface Props {
  commands: Command[];
  activeIndex: number;
  onSelect: (cmd: Command) => void;
}

export function CommandPopup({ commands, activeIndex, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.children[activeIndex] as HTMLElement;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (commands.length === 0) return null;

  return (
    <div className="cc-cmd-popup" ref={listRef}>
      {commands.map((cmd, i) => (
        <div
          key={cmd.name}
          className={`cc-cmd-item ${i === activeIndex ? 'cc-cmd-active' : ''}`}
          onClick={() => onSelect(cmd)}
          onMouseDown={e => e.preventDefault()}
        >
          <span className="cc-cmd-name">/{cmd.name}</span>
          <span className="cc-cmd-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
