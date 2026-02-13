import { useState, useRef, useEffect, useCallback } from 'react';
import { isTauri } from '../../platform/detect';
import { spawnCommand } from '../../platform/shell';
import './Terminal.css';

interface TermLine {
  type: 'stdin' | 'stdout' | 'stderr' | 'system';
  text: string;
}

export function Terminal() {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState('~');
  const childRef = useRef<any>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDesktop = isTauri();

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  useEffect(() => {
    if (isDesktop) {
      setLines([{ type: 'system', text: 'Terminal Panoramix — prêt.' }]);
    }
  }, [isDesktop]);

  const addLine = useCallback((type: TermLine['type'], text: string) => {
    setLines(prev => [...prev, { type, text }]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || running) return;

    const cmd = input.trim();
    setInput('');
    addLine('stdin', `${cwd} $ ${cmd}`);

    // Built-in cd
    if (cmd.startsWith('cd ')) {
      const dir = cmd.slice(3).trim();
      setCwd(dir || '~');
      addLine('system', `→ ${dir || '~'}`);
      return;
    }

    if (cmd === 'clear') {
      setLines([]);
      return;
    }

    setRunning(true);
    const fullCmd = cwd !== '~' ? `cd "${cwd}" && ${cmd}` : cmd;

    const child = await spawnCommand(
      fullCmd,
      (data) => addLine('stdout', data),
      (data) => addLine('stderr', data),
      (code) => {
        addLine('system', `[exit ${code ?? 'signal'}]`);
        setRunning(false);
        childRef.current = null;
        inputRef.current?.focus();
      },
    );

    childRef.current = child;
  };

  const handleKill = async () => {
    if (childRef.current) {
      try {
        await childRef.current.kill();
      } catch { /* ignore */ }
    }
  };

  if (!isDesktop) {
    return (
      <div className="terminal-container">
        <div className="terminal-web-notice">
          <h3>Terminal</h3>
          <p>Le terminal est disponible uniquement en version desktop (Tauri).</p>
          <p>Utilisez <code>npm run tauri:dev</code> pour lancer l'app desktop.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <div className="terminal-actions">
          {running && (
            <button className="terminal-kill-btn" onClick={handleKill}>
              Ctrl+C
            </button>
          )}
          <button className="terminal-clear-btn" onClick={() => setLines([])}>
            Clear
          </button>
        </div>
      </div>

      <div className="terminal-output" onClick={() => inputRef.current?.focus()}>
        {lines.map((line, i) => (
          <div key={i} className={`term-line term-${line.type}`}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="terminal-input-row" onSubmit={handleSubmit}>
        <span className="terminal-prompt">{cwd} $</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={running ? 'Commande en cours...' : 'Tapez une commande...'}
          disabled={running}
          autoFocus
        />
      </form>
    </div>
  );
}
