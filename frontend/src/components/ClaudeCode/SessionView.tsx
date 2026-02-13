import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { claudeCode } from '../../services/api';
import { socketService } from '../../services/socket';
import { MessageBubble, ToolGroupBlock } from './MessageBubble';
import { CommandPopup } from './CommandPopup';
import type { ClaudeSession, ClaudeMessage } from '../../types';
import './SessionView.css';

const BUILTIN_COMMANDS = [
  { name: 'clear', description: 'Clear messages and start fresh', hasArgs: false },
  { name: 'stop', description: 'Stop the running process', hasArgs: false },
  { name: 'model', description: 'Change model (e.g. /model claude-sonnet-4-20250514)', hasArgs: true },
  { name: 'info', description: 'Show session info', hasArgs: false },
  { name: 'help', description: 'Show available commands', hasArgs: false },
];

const PERM_MODES = ['', 'plan', 'acceptEdits', 'bypassPermissions'];
const PERM_LABELS: Record<string, string> = {
  '': 'default',
  plan: 'plan',
  acceptEdits: 'accept-edits',
  bypassPermissions: 'bypass',
};

function formatDuration(ms: number): string {
  if (!ms) return '0s';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}min`;
  const h = Math.floor(m / 60);
  return `${h}h${Math.round(m % 60)}min`;
}

function formatCost(usd: number): string {
  if (!usd) return '$0';
  return `$${usd.toFixed(4)}`;
}

interface Props {
  sessionId: string;
  session?: ClaudeSession;
  homeDir: string;
  projectCwd: string;
}

export function SessionView({ sessionId, session, homeDir: _homeDir, projectCwd: _projectCwd }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [commandIdx, setCommandIdx] = useState(0);
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const [lastToolName, setLastToolName] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isRunning = session?.status === 'running';
  const displayModel = (session?.model || session?.activeModel || '').trim() || null;
  const permMode = session?.permissionMode || '';

  // Reset tool name when not running
  useEffect(() => {
    if (!isRunning) setLastToolName(null);
  }, [isRunning]);

  // Load messages
  useEffect(() => {
    claudeCode.listMessages(sessionId)
      .then(r => setMessages(r.messages))
      .catch(err => console.error('Failed to load messages:', err));
  }, [sessionId]);

  // Subscribe to session socket events
  useEffect(() => {
    socketService.subscribeClaudeSession(sessionId);

    const unsubCreated = socketService.on('claude:message:created', (data: any) => {
      if (data.sessionId === sessionId || data.sessionId?._id === sessionId) {
        setMessages(prev => {
          if (prev.find(m => m._id === data._id)) return prev;
          return [...prev, data];
        });
        // Track last tool name for typing indicator
        if (Array.isArray(data.content)) {
          const toolBlock = data.content.findLast?.((b: any) => b.type === 'tool_use');
          if (toolBlock) setLastToolName(toolBlock.name);
        }
      }
    });

    const unsubUpdated = socketService.on('claude:message:updated', (data: any) => {
      if (data.sessionId === sessionId || data.sessionId?._id === sessionId) {
        setMessages(prev => prev.map(m => m._id === data._id ? data : m));
      }
    });

    return () => {
      unsubCreated();
      unsubUpdated();
      socketService.unsubscribeClaudeSession(sessionId);
    };
  }, [sessionId]);

  // Mark seen when active
  useEffect(() => {
    if (session?.unseenCompleted) {
      claudeCode.markSeen(sessionId).catch(() => {});
    }
  }, [sessionId, session?.unseenCompleted]);

  // Auto-scroll
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;

    const onScroll = () => {
      stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (stuckToBottom.current && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, localMessages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // Group messages: tool-only messages are collapsed
  const flowMessages = useMemo(() => messages.filter(m => !m.queued), [messages]);

  const groupedMessages = useMemo(() => {
    const isToolOnly = (msg: ClaudeMessage) => {
      if (!Array.isArray(msg.content) || msg.content.length === 0) return false;
      const hasToolBlock = msg.content.some(b => b.type === 'tool_use' || b.type === 'tool_result');
      if (!hasToolBlock) return false;
      const hasText = msg.content.some(b => b.type === 'text' && b.text?.trim());
      return !hasText;
    };

    const groups: { type: string; messages?: ClaudeMessage[]; message?: ClaudeMessage; key: string }[] = [];
    let toolGroup: { type: string; messages: ClaudeMessage[]; key: string } | null = null;

    for (const msg of flowMessages) {
      if (isToolOnly(msg)) {
        if (!toolGroup) {
          toolGroup = { type: 'tool-group', messages: [], key: msg._id };
        }
        toolGroup.messages.push(msg);
      } else {
        if (toolGroup) { groups.push(toolGroup); toolGroup = null; }
        groups.push({ type: 'single', message: msg, key: msg._id });
      }
    }
    if (toolGroup) groups.push(toolGroup);
    return groups;
  }, [flowMessages]);

  // Slash commands
  const showCommands = input.startsWith('/');
  const commandFilter = showCommands ? input.slice(1).split(/\s/)[0].toLowerCase() : '';
  const filteredCommands = useMemo(() => {
    if (!showCommands) return [];
    const hasSpace = input.indexOf(' ') > 0;
    const exact = BUILTIN_COMMANDS.find(c => c.name === commandFilter);
    if (exact && hasSpace) return [];
    return BUILTIN_COMMANDS.filter(c => c.name.startsWith(commandFilter));
  }, [showCommands, commandFilter, input]);

  useEffect(() => { setCommandIdx(0); }, [filteredCommands.length]);

  const addLocalMessage = useCallback((text: string, extra?: Record<string, unknown>) => {
    setLocalMessages(prev => [...prev, {
      _id: `local-${Date.now()}`,
      role: 'system',
      type: 'info',
      contentText: text,
      content: [{ type: 'text', text }],
      ...extra,
    }]);
  }, []);

  const executeCommand = useCallback(async (cmdName: string, args: string) => {
    switch (cmdName) {
      case 'clear':
        setLocalMessages([]);
        setMessages([]);
        try { await claudeCode.clearMessages(sessionId); } catch {}
        break;
      case 'stop':
        try { await claudeCode.stopSession(sessionId); } catch {}
        break;
      case 'model': {
        const model = args.trim();
        if (!model) { addLocalMessage('Usage: /model <name>'); return; }
        try {
          await claudeCode.updateSession(sessionId, { model } as Partial<ClaudeSession>);
          addLocalMessage(`Model set to ${model}`);
        } catch (err: any) {
          addLocalMessage(`Failed: ${err.message}`);
        }
        break;
      }
      case 'info':
        addLocalMessage(`Version: ${session?.claudeCodeVersion || '(unknown)'}\nModel: ${displayModel || '(default)'}\nPermission: ${permMode || 'default'}\nStatus: ${session?.status}\nCost: ${formatCost(session?.totalCostUsd || 0)}\nDuration: ${formatDuration(session?.totalDurationMs || 0)}\nSession ID: ${session?.claudeSessionId || '(none)'}`);
        break;
      case 'help':
        addLocalMessage(BUILTIN_COMMANDS.map(c => `/${c.name} — ${c.description}`).join('\n') + '\n!cmd — Run shell command\nTab — Cycle permission mode\nEscape — Stop process');
        break;
    }
  }, [sessionId, session, addLocalMessage, displayModel, permMode]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    // Slash command
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmdName = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';
      executeCommand(cmdName, args);
      return;
    }

    // Shell escape
    if (text.startsWith('!')) {
      const cmd = text.slice(1).trim();
      if (!cmd) return;
      try { await claudeCode.execShell(sessionId, cmd); } catch {}
      return;
    }

    // Send message to Claude
    try {
      const result = await claudeCode.sendMessage(sessionId, text);
      // Add user message to the list from API response
      if (result.message) {
        setMessages(prev => {
          if (prev.find(m => m._id === result.message._id)) return prev;
          return [...prev, result.message];
        });
      }
    } catch (err: any) {
      console.error('Send failed:', err);
      addLocalMessage(`Send failed: ${err.message}`);
    }
  }, [input, sessionId, executeCommand, addLocalMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Escape = stop
    if (e.key === 'Escape' && isRunning) {
      e.preventDefault();
      claudeCode.stopSession(sessionId).catch(() => {});
      return;
    }

    // Tab = cycle permission mode
    if (e.key === 'Tab' && !e.shiftKey && !showCommands) {
      e.preventDefault();
      const idx = PERM_MODES.indexOf(permMode);
      const next = PERM_MODES[(idx + 1) % PERM_MODES.length];
      claudeCode.updateSession(sessionId, { permissionMode: next } as Partial<ClaudeSession>).catch(() => {});
      return;
    }

    // Command popup navigation
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIdx(i => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIdx(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && filteredCommands.length > 0) {
        e.preventDefault();
        const cmd = filteredCommands[commandIdx];
        if (cmd.hasArgs) {
          setInput(`/${cmd.name} `);
        } else {
          setInput('');
          executeCommand(cmd.name, '');
        }
        return;
      }
    }

    // Enter = send (Shift+Enter = newline)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [isRunning, showCommands, filteredCommands, commandIdx, permMode, sessionId, executeCommand, handleSend]);

  const selectCommand = useCallback((cmd: { name: string; hasArgs?: boolean }) => {
    if (cmd.hasArgs) {
      setInput(`/${cmd.name} `);
      textareaRef.current?.focus();
    } else {
      setInput('');
      executeCommand(cmd.name, '');
    }
  }, [executeCommand]);

  return (
    <div className="cc-session">
      {/* Messages area */}
      <div className="cc-messages" ref={messagesRef}>
        {groupedMessages.map(group => {
          if (group.type === 'tool-group') {
            return <ToolGroupBlock key={group.key} messages={group.messages!} />;
          }
          return <MessageBubble key={group.key} message={group.message!} sessionId={sessionId} />;
        })}
        {localMessages.map(msg => (
          <MessageBubble key={msg._id} message={msg} sessionId={sessionId} />
        ))}
        {isRunning && (
          <div className="cc-typing-indicator">
            <span className="cc-typing-dot" />
            <span className="cc-typing-dot" />
            <span className="cc-typing-dot" />
            {lastToolName && (
              <span className="cc-tool-name">{lastToolName}</span>
            )}
            {(session?.queuedCount || 0) > 0 && (
              <span className="cc-queued-count">{session!.queuedCount} queued</span>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="cc-status-bar">
        <span className={`cc-status-dot cc-status-dot-small cc-status-${session?.status || 'idle'}`} />
        <span className={`cc-status-indicator cc-status-${session?.status || 'idle'}`}>
          {session?.status || 'idle'}
        </span>
        {displayModel && <span className="cc-status-model">{displayModel}</span>}
        <span className="cc-status-perm" title="Press Tab to cycle">
          {PERM_LABELS[permMode] || permMode || 'default'}
        </span>
        {(session?.totalCostUsd || 0) > 0 && (
          <span className="cc-status-cost">{formatCost(session?.totalCostUsd || 0)}</span>
        )}
        {(session?.totalDurationMs || 0) > 0 && (
          <span className="cc-status-duration">{formatDuration(session?.totalDurationMs || 0)}</span>
        )}
      </div>

      {/* Input area */}
      <div className="cc-input-area">
        {showCommands && filteredCommands.length > 0 && (
          <CommandPopup
            commands={filteredCommands}
            activeIndex={commandIdx}
            onSelect={selectCommand}
          />
        )}
        <textarea
          ref={textareaRef}
          className="cc-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Claude is working... (Esc to stop)' : 'Type a message... (/ for commands, ! for shell)'}
          rows={1}
        />
        <button
          className="cc-send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          {isRunning ? '\u25A0' : '\u2191'}
        </button>
      </div>
    </div>
  );
}
