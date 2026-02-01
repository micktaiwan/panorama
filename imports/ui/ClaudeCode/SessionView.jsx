import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { notify } from '/imports/ui/utils/notify.js';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { MessageBubble, ToolGroupBlock } from './MessageBubble.jsx';
import { CommandPopup } from './CommandPopup.jsx';
import { shortenPath } from './useHomeDir.js';
import './SessionView.css';

const COMMANDS = [
  { name: 'clear', description: 'Clear messages and start fresh', hasArgs: false },
  { name: 'stop', description: 'Stop the running process', hasArgs: false },
  { name: 'model', description: 'Change model (e.g. /model claude-sonnet-4-20250514)', hasArgs: true },
  { name: 'cwd', description: 'Change working directory', hasArgs: true },
  { name: 'help', description: 'Show available commands', hasArgs: false },
];

export const SessionView = ({ sessionId, homeDir, isActive, onFocus }) => {
  const [input, setInput] = useState('');
  const [editingSettings, setEditingSettings] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const [commandIdx, setCommandIdx] = useState(0);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useSubscribe('claudeSessions');
  useSubscribe('claudeMessages.bySession', sessionId);

  const session = useFind(() =>
    ClaudeSessionsCollection.find(sessionId ? { _id: sessionId } : { _id: '__none__' }),
    [sessionId]
  )[0];

  const messages = useFind(() =>
    ClaudeMessagesCollection.find(
      sessionId ? { sessionId } : { sessionId: '__none__' },
      { sort: { createdAt: 1 } }
    ),
    [sessionId]
  );

  const isRunning = session?.status === 'running';

  const groupedMessages = useMemo(() => {
    const isToolOnly = (msg) => {
      if (!Array.isArray(msg.content) || msg.content.length === 0) return false;
      const hasToolBlock = msg.content.some(b => b.type === 'tool_use' || b.type === 'tool_result');
      if (!hasToolBlock) return false;
      const hasAskQuestion = msg.content.some(b => b.type === 'tool_use' && b.name === 'AskUserQuestion');
      if (hasAskQuestion) return false;
      const hasText = msg.content.some(b => b.type === 'text' && b.text?.trim());
      return !hasText;
    };

    const groups = [];
    let toolGroup = null;

    for (const msg of messages) {
      if (isToolOnly(msg)) {
        if (!toolGroup) {
          toolGroup = { type: 'tool-group', messages: [], key: msg._id };
        }
        toolGroup.messages.push(msg);
      } else {
        if (toolGroup) {
          groups.push(toolGroup);
          toolGroup = null;
        }
        groups.push({ type: 'single', message: msg, key: msg._id });
      }
    }
    if (toolGroup) groups.push(toolGroup);

    return groups;
  }, [messages]);

  // Slash command popup
  const showCommands = input.startsWith('/');
  const commandFilter = showCommands ? input.slice(1).split(/\s/)[0].toLowerCase() : '';
  const filteredCommands = useMemo(() => {
    if (!showCommands) return [];
    // If input has a space after the command name, don't show popup (user is typing args)
    const hasSpace = input.indexOf(' ') > 0;
    const typed = commandFilter;
    const exact = COMMANDS.find(c => c.name === typed);
    if (exact && hasSpace) return [];
    return COMMANDS.filter(c => c.name.startsWith(typed));
  }, [showCommands, commandFilter, input]);

  // Reset commandIdx when filtered list changes
  useEffect(() => {
    setCommandIdx(0);
  }, [filteredCommands.length]);

  const addLocalMessage = (text) => {
    setLocalMessages(prev => [...prev, {
      _id: `local-${Date.now()}`,
      role: 'system',
      contentText: text,
      isLocal: true,
    }]);
  };

  const executeCommand = (cmdName, args) => {
    switch (cmdName) {
      case 'clear':
        setLocalMessages([]);
        Meteor.call('claudeSessions.clearMessages', sessionId, (err) => {
          if (err) notify({ message: `Clear failed: ${err.reason || err.message}`, kind: 'error' });
          else notify({ message: 'Messages cleared', kind: 'success' });
        });
        break;
      case 'stop':
        Meteor.call('claudeSessions.stop', sessionId, (err) => {
          if (err) notify({ message: `Stop failed: ${err.reason || err.message}`, kind: 'error' });
        });
        break;
      case 'model': {
        const model = args.trim();
        if (!model) { notify({ message: 'Usage: /model <name>', kind: 'error' }); return; }
        Meteor.call('claudeSessions.update', sessionId, { model }, (err) => {
          if (err) notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' });
          else notify({ message: `Model set to ${model}`, kind: 'success' });
        });
        break;
      }
      case 'cwd': {
        const cwd = args.trim();
        if (!cwd) { notify({ message: 'Usage: /cwd <path>', kind: 'error' }); return; }
        Meteor.call('claudeSessions.update', sessionId, { cwd }, (err) => {
          if (err) notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' });
          else notify({ message: `Working directory set to ${cwd}`, kind: 'success' });
        });
        break;
      }
      case 'help': {
        const lines = COMMANDS.map(c => `**/${c.name}** — ${c.description}`).join('\n');
        addLocalMessage(`Available commands:\n\n${lines}`);
        break;
      }
    }
  };

  // Instant scroll on load/session switch, smooth only for new messages during conversation
  const scrolledSession = useRef(null);
  useEffect(() => {
    const isInitial = scrolledSession.current !== sessionId;
    messagesEndRef.current?.scrollIntoView({ behavior: isInitial ? 'instant' : 'smooth' });
    if (messages.length > 0) scrolledSession.current = sessionId;
  }, [sessionId, messages.length, messages[messages.length - 1]?.contentText, localMessages.length, isRunning]);

  // Clear local messages when new DB messages arrive
  useEffect(() => {
    if (localMessages.length > 0) setLocalMessages([]);
  }, [messages.length]);

  // Focus textarea when session becomes idle or panel becomes active
  useEffect(() => {
    if (isActive && !isRunning) textareaRef.current?.focus();
  }, [isActive, isRunning]);

  // Global ESC handler — works even when textarea doesn't have focus
  useEffect(() => {
    if (!isActive || !isRunning) return;
    const handleGlobalEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        addLocalMessage('Interrupted by user (ESC)');
        Meteor.call('claudeSessions.stop', sessionId);
      }
    };
    document.addEventListener('keydown', handleGlobalEsc);
    return () => document.removeEventListener('keydown', handleGlobalEsc);
  }, [isActive, isRunning, sessionId]);

  if (!sessionId) {
    return (
      <div className="ccSessionViewEmpty">
        <p className="muted">Select or create a project to start.</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ccSessionViewEmpty">
        <p className="muted">Loading session...</p>
      </div>
    );
  }

  const sendMessage = (text) => {
    Meteor.call('claudeSessions.sendMessage', sessionId, text, (err) => {
      if (err) notify({ message: `Send failed: ${err.reason || err.message}`, kind: 'error' });
    });
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    // Intercept shell escape
    if (text.startsWith('!')) {
      const shellCmd = text.slice(1).trim();
      if (!shellCmd) return;
      setInput('');
      Meteor.call('claudeSessions.execShell', sessionId, shellCmd, (err) => {
        if (err) notify({ message: `Shell: ${err.reason || err.message}`, kind: 'error' });
      });
      return;
    }

    // Intercept slash commands
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmdName = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';
      const cmd = COMMANDS.find(c => c.name === cmdName);
      if (cmd) {
        setInput('');
        executeCommand(cmdName, args);
        return;
      }
    }

    setInput('');
    sendMessage(text);
  };

  const handleStop = () => {
    Meteor.call('claudeSessions.stop', sessionId, (err) => {
      if (err) notify({ message: `Stop failed: ${err.reason || err.message}`, kind: 'error' });
    });
  };

  const handleClear = () => {
    Meteor.call('claudeSessions.clearMessages', sessionId, (err) => {
      if (err) notify({ message: `Clear failed: ${err.reason || err.message}`, kind: 'error' });
      else notify({ message: 'Messages cleared', kind: 'success' });
    });
  };

  const handleCommandSelect = (cmd) => {
    if (cmd.hasArgs) {
      setInput(`/${cmd.name} `);
      textareaRef.current?.focus();
    } else {
      setInput('');
      executeCommand(cmd.name, '');
    }
  };

  const handleKeyDown = (e) => {
    if (filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIdx(prev => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIdx(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleCommandSelect(filteredCommands[commandIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        handleCommandSelect(filteredCommands[commandIdx]);
        return;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const modes = ['', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'];
      const current = session.permissionMode || '';
      const next = modes[(modes.indexOf(current) + 1) % modes.length];
      Meteor.call('claudeSessions.update', sessionId, { permissionMode: next });
      return;
    }
    if (e.key === 'Escape' && isRunning) {
      e.preventDefault();
      addLocalMessage('Interrupted by user (ESC)');
      handleStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSettingsSave = (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value,
      cwd: form.cwd.value,
      model: form.model.value,
      permissionMode: form.permissionMode.value,
      appendSystemPrompt: form.appendSystemPrompt.value,
    };
    Meteor.call('claudeSessions.update', sessionId, data, (err) => {
      if (err) notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' });
      else {
        setEditingSettings(false);
        notify({ message: 'Settings saved', kind: 'success' });
      }
    });
  };

  return (
    <div className="ccSessionView">
      {/* Header */}
      <div className="ccSessionHeader">
        <div className="ccSessionInfo">
          <InlineEditable
            value={session.name}
            className="ccSessionName"
            onSubmit={(name) => {
              Meteor.call('claudeSessions.update', sessionId, { name }, (err) => {
                if (err) notify({ message: `Rename failed: ${err.reason || err.message}`, kind: 'error' });
              });
            }}
          />
          <span className="ccSessionCwd muted">{shortenPath(session.cwd, homeDir) || '(default cwd)'}</span>
          {session.model && <span className="ccSessionModel muted">{session.model}</span>}
          <span className={`ccStatusBadge ccStatus-${session.status}`}>{session.status}</span>
        </div>
        <div className="ccSessionActions">
          <button className="btn btn-small" onClick={() => setEditingSettings(!editingSettings)}>
            {editingSettings ? 'Cancel' : 'Settings'}
          </button>
          <button className="btn btn-small" onClick={handleClear} disabled={isRunning}>Clear</button>
        </div>
      </div>

      {/* Settings form */}
      {editingSettings && (
        <form className="ccSettingsForm" onSubmit={handleSettingsSave}>
          <label>
            Name
            <input name="name" defaultValue={session.name} />
          </label>
          <label>
            Working Directory
            <input name="cwd" defaultValue={session.cwd || ''} placeholder="/path/to/project" />
          </label>
          <label>
            Model
            <input name="model" defaultValue={session.model || ''} placeholder="e.g. claude-sonnet-4-20250514" />
          </label>
          <label>
            Permission Mode
            <select name="permissionMode" defaultValue={session.permissionMode || ''}>
              <option value="">Default (interactive)</option>
              <option value="plan">Plan (read-only)</option>
              <option value="acceptEdits">Accept Edits</option>
              <option value="dontAsk">Don't Ask</option>
              <option value="bypassPermissions">Bypass Permissions</option>
            </select>
          </label>
          <label>
            System Prompt (append)
            <textarea name="appendSystemPrompt" defaultValue={session.appendSystemPrompt || ''} rows={3} />
          </label>
          <button type="submit" className="btn btn-primary btn-small">Save</button>
        </form>
      )}

      {/* Messages area */}
      <div className="ccMessages scrollArea">
        {messages.length === 0 && localMessages.length === 0 && (
          <p className="muted ccEmptyChat">No messages yet. Send a message to start.</p>
        )}
        {groupedMessages.map((group, idx) =>
          group.type === 'tool-group'
            ? <ToolGroupBlock
                key={group.key}
                messages={group.messages}
                autoExpanded={isRunning && idx === groupedMessages.length - 1}
                onAnswer={sendMessage}
              />
            : <MessageBubble
                key={group.key}
                message={group.message}
                onAnswer={sendMessage}
                sessionId={sessionId}
              />
        )}
        {localMessages.map((msg) => (
          <MessageBubble key={msg._id} message={msg} />
        ))}
        {isRunning && (
          <div className="ccTypingIndicator">
            <span className="ccTypingDot" /><span className="ccTypingDot" /><span className="ccTypingDot" />
            {session.queuedCount > 0 && (
              <span className="ccQueuedCount">{session.queuedCount} queued</span>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {session.lastError && (
        <div className="ccError">{session.lastError}</div>
      )}

      {/* Composer */}
      <div className="ccComposer">
        {filteredCommands.length > 0 && (
          <CommandPopup
            commands={filteredCommands}
            activeIdx={commandIdx}
            onSelect={handleCommandSelect}
          />
        )}
        <textarea
          ref={textareaRef}
          className="ccInput"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, !cmd for shell, /help for commands)"
          rows={3}
        />
        {isRunning && (
          <div className="ccComposerActions">
            <button className="btn btn-danger btn-small" onClick={handleStop}>Stop</button>
          </div>
        )}
      </div>
      <div className="ccComposerFooter">
        <select
          className={`ccPermModeSelect${session.permissionMode ? ` ccMode-${session.permissionMode}` : ''}`}
          value={session.permissionMode || ''}
          onChange={(e) => {
            const permissionMode = e.target.value || undefined;
            Meteor.call('claudeSessions.update', sessionId, { permissionMode }, (err) => {
              if (err) notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' });
            });
          }}
        >
          <option value="">💬 Default</option>
          <option value="plan">📋 Plan</option>
          <option value="acceptEdits">✏️ Accept Edits</option>
          <option value="dontAsk">🚀 Don't Ask</option>
          <option value="bypassPermissions">⚠️ Bypass</option>
        </select>
      </div>

      {/* Footer stats */}
      {(session.totalCostUsd > 0 || session.totalDurationMs > 0) && (
        <div className="ccSessionStats muted">
          {session.totalCostUsd > 0 && <span>Total cost: ${session.totalCostUsd.toFixed(4)}</span>}
          {session.totalDurationMs > 0 && <span>Total time: {(session.totalDurationMs / 1000).toFixed(1)}s</span>}
        </div>
      )}
    </div>
  );
};
