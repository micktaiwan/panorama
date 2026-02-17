import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { ClaudeCommandsCollection } from '/imports/api/claudeCommands/collections';
import { notify } from '/imports/ui/utils/notify.js';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { MessageBubble, ToolGroupBlock } from './MessageBubble.jsx';
import { CommandPopup } from './CommandPopup.jsx';
import { shortenPath } from './useHomeDir.js';
import './SessionView.css';

const formatDuration = (ms) => {
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const totalMin = totalSec / 60;
  if (totalMin < 60) return `${totalMin.toFixed(1)}min`;
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return m > 0 ? `${h}h${m}min` : `${h}h`;
};

const BUILTIN_COMMANDS = [
  { name: 'clear', description: 'Clear messages and start fresh', hasArgs: false },
  { name: 'stop', description: 'Stop the running process', hasArgs: false },
  { name: 'model', description: 'Change model (e.g. /model claude-sonnet-4-20250514)', hasArgs: true },
  { name: 'cwd', description: 'Change working directory (WARNING: stops active session)', hasArgs: true },
  { name: 'codex', description: 'Run Codex CLI one-shot (e.g. /codex review changes)', hasArgs: true },
  { name: 'debate', description: 'Start a debate between Claude and Codex (e.g. /debate should we use TypeScript?)', hasArgs: true },
  { name: 'info', description: 'Show Claude version and context usage', hasArgs: false },
  { name: 'help', description: 'Show available commands', hasArgs: false },
];

export const SessionView = ({ sessionId, homeDir, isActive, onFocus: _onFocus, onNewSession }) => {
  const [input, setInput] = useState('');
  const [editingSettings, setEditingSettings] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const [commandIdx, setCommandIdx] = useState(0);
  const [attachedImages, setAttachedImages] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const messagesContainerRef = useRef(null);
  const stuckToBottom = useRef(true);
  const isAutoScrolling = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const textareaRef = useRef(null);

  useSubscribe('claudeSessions');
  useSubscribe('claudeMessages.bySession', sessionId);
  useSubscribe('claudeCommands');

  const session = useFind(() =>
    ClaudeSessionsCollection.find(sessionId ? { _id: sessionId } : { _id: '__none__' }),
    [sessionId]
  )[0];

  const customCommands = useFind(() => ClaudeCommandsCollection.find({}));

  const allMessages = useFind(() =>
    ClaudeMessagesCollection.find(
      sessionId ? { sessionId } : { sessionId: '__none__' },
      { sort: { createdAt: 1 } }
    ),
    [sessionId]
  );

  const flowMessages = useMemo(() => allMessages.filter(m => !m.queued), [allMessages]);
  const queuedMessages = useMemo(() => allMessages.filter(m => m.queued), [allMessages]);

  const isRunning = session?.status === 'running';
  const isCodexRunning = session?.codexRunning;
  const isDebateRunning = session?.debateRunning;
  const debateRound = session?.debateRound;
  const debateCurrentAgent = session?.debateCurrentAgent;
  const isFrozen = session?.status === 'error';
  const displayModel = (session?.model || session?.activeModel || '').trim() || null;
  const activeAgent = session?.activeAgent || 'claude';
  const isBusy = isRunning || isCodexRunning || isDebateRunning;

  // Auto-clear unseenCompleted when viewing this session
  useEffect(() => {
    if (session?.unseenCompleted && isActive) {
      Meteor.call('claudeSessions.markSeen', session._id);
    }
  }, [session?._id, session?.unseenCompleted, isActive]);

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

    for (const msg of flowMessages) {
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
  }, [flowMessages]);

  // Merge built-in commands with custom commands from DB
  const projectId = session?.projectId;
  const allCommands = useMemo(() => {
    const builtinNames = new Set(BUILTIN_COMMANDS.map(c => c.name));
    const merged = [...BUILTIN_COMMANDS];
    for (const cmd of customCommands) {
      if (builtinNames.has(cmd.name)) continue;
      if (cmd.scope === 'project' && cmd.projectId !== projectId) continue;
      merged.push({ ...cmd, isCustom: true });
    }
    return merged;
  }, [customCommands, projectId]);

  // Slash command popup
  const showCommands = input.startsWith('/');
  const commandFilter = showCommands ? input.slice(1).split(/\s/)[0].toLowerCase() : '';
  const filteredCommands = useMemo(() => {
    if (!showCommands) return [];
    const hasSpace = input.indexOf(' ') > 0;
    const typed = commandFilter;
    const exact = allCommands.find(c => c.name === typed);
    if (exact && hasSpace) return [];
    return allCommands.filter(c => c.name.startsWith(typed));
  }, [showCommands, commandFilter, input, allCommands]);

  // Reset commandIdx when filtered list changes
  useEffect(() => {
    setCommandIdx(0);
  }, [filteredCommands.length]);

  const addLocalMessage = (text, extra) => {
    setLocalMessages(prev => [...prev, {
      _id: `local-${Date.now()}`,
      role: 'system',
      contentText: text,
      isLocal: true,
      ...extra,
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
        if (isDebateRunning) {
          Meteor.call('claudeSessions.stopDebate', sessionId, (err) => {
            if (err) notify({ message: `Stop failed: ${err.reason || err.message}`, kind: 'error' });
          });
        } else {
          Meteor.call('claudeSessions.stop', sessionId, (err) => {
            if (err) notify({ message: `Stop failed: ${err.reason || err.message}`, kind: 'error' });
          });
        }
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
        Meteor.call('claudeSessions.changeCwd', sessionId, cwd, (err, result) => {
          if (err) { notify({ message: `Update failed: ${err.reason || err.message}`, kind: 'error' }); return; }
          if (result?.stopped) {
            notify({ message: `Session stopped. New session created with cwd: ${cwd}`, kind: 'info' });
            onNewSession?.(result.sessionId);
          } else {
            notify({ message: `Working directory set to ${cwd}`, kind: 'success' });
          }
        });
        break;
      }
      case 'info': {
        addLocalMessage(null, {
          localType: 'info',
          infoData: {
            version: session.claudeCodeVersion,
            model: session.activeModel || session.model,
            permissionMode: session.permissionMode,
            status: session.status,
            cwd: session.cwd,
            claudeSessionId: session.claudeSessionId,
            modelUsage: session.lastModelUsage,
            totalCostUsd: session.totalCostUsd,
            totalDurationMs: session.totalDurationMs,
          },
        });
        break;
      }
      case 'help': {
        const lines = allCommands.map(c => `**/${c.name}**${c.isCustom ? ' *(custom)*' : ''} — ${c.description || '(no description)'}`).join('\n');
        addLocalMessage(`Available commands:\n\n${lines}`);
        break;
      }
      case 'codex': {
        if (!args.trim()) {
          addLocalMessage('Usage: /codex <prompt>');
          return;
        }
        Meteor.call('claudeSessions.execCodex', sessionId, args.trim(), (err) => {
          if (err) notify({ message: `Codex: ${err.reason || err.message}`, kind: 'error' });
        });
        break;
      }
      case 'debate': {
        if (!args.trim()) {
          addLocalMessage('Usage: /debate <subject>');
          return;
        }
        Meteor.call('claudeSessions.execDebate', sessionId, args.trim(), (err) => {
          if (err) notify({ message: `Debate: ${err.reason || err.message}`, kind: 'error' });
        });
        break;
      }
      default: {
        const cmd = allCommands.find(c => c.name === cmdName && c.isCustom);
        if (cmd) {
          let prompt = cmd.content;
          if (cmd.hasArgs) prompt = prompt.replace(/\$ARGUMENTS/g, args.trim());
          sendMessage(prompt);
        }
        break;
      }
    }
  };

  // Scroll helpers
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (behavior === 'instant') {
      el.scrollTop = el.scrollHeight;
    } else {
      isAutoScrolling.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setTimeout(() => { isAutoScrolling.current = false; }, 1000);
    }
    stuckToBottom.current = true;
    setShowScrollDown(false);
  }, []);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (isAutoScrolling.current) {
      if (atBottom) isAutoScrolling.current = false;
      return;
    }
    stuckToBottom.current = atBottom;
    setShowScrollDown(!atBottom);
  };

  // Auto-scroll: instant until first content on session switch, smooth for new messages
  const initialScrollDone = useRef(null);
  useEffect(() => {
    const needsInitialScroll = initialScrollDone.current !== sessionId;
    if (needsInitialScroll) {
      stuckToBottom.current = true;
      setShowScrollDown(false);
      scrollToBottom('instant');
      if (flowMessages.length > 0) initialScrollDone.current = sessionId;
      return;
    }
    if (stuckToBottom.current) {
      scrollToBottom('smooth');
    }
  }, [sessionId, flowMessages, localMessages.length, isRunning, scrollToBottom]);

  // Clear local messages when a new user message is sent (DB count changes from user action)
  const userMessageCount = allMessages.filter(m => m.role === 'user').length;
  useEffect(() => {
    if (localMessages.length > 0) setLocalMessages([]);
  }, [userMessageCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [input]);

  // Focus textarea when session becomes idle or panel becomes active
  useEffect(() => {
    if (isActive && !isRunning) textareaRef.current?.focus();
  }, [isActive, isRunning]);

  // Global ESC handler — works even when textarea doesn't have focus
  useEffect(() => {
    if (!isActive || (!isRunning && !isDebateRunning)) return;
    const handleGlobalEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDebateRunning) {
          addLocalMessage('Debate stopped by user (ESC)');
          Meteor.call('claudeSessions.stopDebate', sessionId);
        } else {
          addLocalMessage('Interrupted by user (ESC)');
          Meteor.call('claudeSessions.stop', sessionId);
        }
      }
    };
    document.addEventListener('keydown', handleGlobalEsc);
    return () => document.removeEventListener('keydown', handleGlobalEsc);
  }, [isActive, isRunning, isDebateRunning, sessionId]);

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

  const addImages = (files) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        setAttachedImages(prev => [...prev, {
          data: base64,
          mediaType: file.type,
          previewUrl: reader.result,
          name: file.name,
        }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (idx) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (isFrozen) return;
    addImages(e.dataTransfer.files);
  };

  const handlePaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.some(f => f.type.startsWith('image/'))) {
      e.preventDefault();
      addImages(files);
    }
  };

  const sendMessage = (text, images) => {
    Meteor.call('claudeSessions.sendMessage', sessionId, text, images || null, (err) => {
      if (err) notify({ message: `Send failed: ${err.reason || err.message}`, kind: 'error' });
    });
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    if (isFrozen) return;
    const text = input.trim();
    if (!text && attachedImages.length === 0) return;

    // Intercept shell escape
    if (text.startsWith('!') && attachedImages.length === 0) {
      const shellCmd = text.slice(1).trim();
      if (!shellCmd) return;
      setInput('');
      Meteor.call('claudeSessions.execShell', sessionId, shellCmd, (err) => {
        if (err) notify({ message: `Shell: ${err.reason || err.message}`, kind: 'error' });
      });
      return;
    }

    // Intercept slash commands
    if (text.startsWith('/') && attachedImages.length === 0) {
      const spaceIdx = text.indexOf(' ');
      const cmdName = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';
      const cmd = allCommands.find(c => c.name === cmdName);
      if (cmd) {
        setInput('');
        executeCommand(cmdName, args);
        return;
      }
    }

    const images = attachedImages.length > 0
      ? attachedImages.map(({ data, mediaType }) => ({ data, mediaType }))
      : null;
    setInput('');
    setAttachedImages([]);

    if (activeAgent === 'codex') {
      // Route to Codex with conversation context
      Meteor.call('claudeSessions.execCodex', sessionId, text || 'Describe this image.', { conversational: true }, (err) => {
        if (err) notify({ message: `Codex: ${err.reason || err.message}`, kind: 'error' });
      });
    } else {
      sendMessage(text || 'Describe this image.', images);
    }
  };

  const handleStop = () => {
    const method = isDebateRunning ? 'claudeSessions.stopDebate' : 'claudeSessions.stop';
    Meteor.call(method, sessionId, (err) => {
      if (err) notify({ message: `Stop failed: ${err.reason || err.message}`, kind: 'error' });
    });
  };

  const handleClear = () => {
    Meteor.call('claudeSessions.clearMessages', sessionId, (err) => {
      if (err) notify({ message: `Clear failed: ${err.reason || err.message}`, kind: 'error' });
      else notify({ message: 'Messages cleared', kind: 'success' });
    });
  };

  const handleNewSession = () => {
    if (!session?.projectId || !onNewSession) return;
    Meteor.call('claudeSessions.createInProject', session.projectId, { name: session.name }, (err, newId) => {
      if (err) {
        notify({ message: `New session failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      onNewSession(newId);
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
      <div className="ccMessagesWrapper">
        <div className="ccMessages scrollArea" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
          {flowMessages.length === 0 && localMessages.length === 0 && (
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
          {(isRunning || isCodexRunning || isDebateRunning) && (
            <div className="ccTypingIndicator">
              <span className="ccTypingDot" /><span className="ccTypingDot" /><span className="ccTypingDot" />
              {isDebateRunning && (
                <>
                  <span className={`ccDebateAgentLabel ccDebateAgent-${debateCurrentAgent}`}>{debateCurrentAgent}</span>
                  <span className="ccDebateRound">Round {debateRound}/5</span>
                </>
              )}
              {isCodexRunning && !isDebateRunning && <span className="ccCodexLabel">codex</span>}
              {session.queuedCount > 0 && (
                <span className="ccQueuedCount">{session.queuedCount} queued</span>
              )}
            </div>
          )}
        </div>
        {showScrollDown && (
          <button className="ccScrollToBottom" onClick={() => scrollToBottom('smooth')}>↓</button>
        )}
      </div>

      {/* Error / frozen banner */}
      {isFrozen && session.lastError ? (
        <div className="ccFrozenBanner">
          <span className="ccFrozenError">{session.lastError}</span>
          <button className="btn btn-small" onClick={handleNewSession}>New Session</button>
        </div>
      ) : session.lastError ? (
        <div className="ccError">{session.lastError}</div>
      ) : null}

      {/* Queued messages stack */}
      {queuedMessages.length > 0 && (
        <div className="ccQueuedStack">
          {queuedMessages.map(msg => (
            <div key={msg._id} className="ccQueuedItem">
              <span className="ccQueuedBadge">queued</span>
              <span className="ccQueuedText">{msg.contentText}</span>
              <button
                className="ccDequeueBtn"
                onClick={() => {
                  Meteor.call('claudeSessions.dequeueMessage', sessionId, msg._id, (err) => {
                    if (err) notify({ message: `Dequeue failed: ${err.reason || err.message}`, kind: 'error' });
                  });
                }}
              >&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div
        className={`ccComposer${dragOver ? ' ccComposer--dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!isFrozen && filteredCommands.length > 0 && (
          <CommandPopup
            commands={filteredCommands}
            activeIdx={commandIdx}
            onSelect={handleCommandSelect}
          />
        )}
        {attachedImages.length > 0 && (
          <div className="ccImagePreview">
            {attachedImages.map((img, i) => (
              <div key={i} className="ccImageThumb">
                <img src={img.previewUrl} alt={img.name} />
                <button className="ccImageRemove" onClick={() => removeImage(i)}>&times;</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="ccInput"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isFrozen ? 'Session ended with error. Start a new session to continue.' : isDebateRunning ? 'Debate in progress... Press ESC to stop.' : activeAgent === 'codex' ? 'Ask Codex... (Enter to send)' : 'Type a message... (Enter to send, !cmd for shell, /help for commands)'}
          rows={1}
          disabled={isFrozen || isDebateRunning}
        />
        {!isFrozen && isRunning && (
          <div className="ccComposerActions">
            <button className="btn btn-danger btn-small" onClick={handleStop}>Stop</button>
          </div>
        )}
      </div>
      <div className="ccStatusBar">
        <div className="ccAgentToggle">
          <button
            className={`ccAgentBtn${activeAgent === 'claude' ? ' ccAgentBtn--active' : ''}`}
            disabled={isBusy}
            onClick={() => {
              Meteor.call('claudeSessions.update', sessionId, { activeAgent: 'claude' });
            }}
          >Claude</button>
          <button
            className={`ccAgentBtn ccAgentBtn--codex${activeAgent === 'codex' ? ' ccAgentBtn--active' : ''}`}
            disabled={isBusy}
            onClick={() => {
              Meteor.call('claudeSessions.update', sessionId, { activeAgent: 'codex' });
            }}
          >Codex</button>
        </div>
        {activeAgent === 'claude' ? (
          <>
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
              <option value="">▷ Default</option>
              <option value="plan">☰ Plan</option>
              <option value="acceptEdits">✎ Accept Edits</option>
              <option value="dontAsk">▶ Don&#39;t Ask</option>
              <option value="bypassPermissions">◆ Bypass</option>
            </select>
            <select
              className="ccEffortSelect"
              value={session.claudeEffort || ''}
              onChange={(e) => {
                Meteor.call('claudeSessions.update', sessionId, { claudeEffort: e.target.value || undefined });
              }}
            >
              <option value="">Effort: default</option>
              <option value="low">Effort: low</option>
              <option value="medium">Effort: medium</option>
              <option value="high">Effort: high</option>
              <option value="max">Effort: max</option>
            </select>
          </>
        ) : (
          <>
            <select
              className="ccModelSelect"
              value={session.codexModel || ''}
              onChange={(e) => {
                Meteor.call('claudeSessions.update', sessionId, { codexModel: e.target.value || undefined });
              }}
            >
              <option value="">Model: default</option>
              <option value="gpt-5.3-codex">gpt-5.3-codex</option>
              <option value="gpt-5.2-codex">gpt-5.2-codex</option>
              <option value="gpt-5.1-codex-mini">gpt-5.1-codex-mini</option>
              <option value="gpt-5.1-codex-max">gpt-5.1-codex-max</option>
            </select>
            <select
              className="ccEffortSelect"
              value={session.codexReasoningEffort || ''}
              onChange={(e) => {
                Meteor.call('claudeSessions.update', sessionId, { codexReasoningEffort: e.target.value || undefined });
              }}
            >
              <option value="">Reasoning: default</option>
              <option value="minimal">Reasoning: minimal</option>
              <option value="low">Reasoning: low</option>
              <option value="medium">Reasoning: medium</option>
              <option value="high">Reasoning: high</option>
              <option value="xhigh">Reasoning: xhigh</option>
            </select>
          </>
        )}
        {displayModel && (
          <span className="ccModelBadge" title={displayModel}>
            {displayModel.replace(/^claude-/, '').replace(/-\d{8}$/, '')}
          </span>
        )}
        <span className={`ccStatusBadge ccStatus-${session.status}`}>{session.status}</span>
        <div className="ccStatusBarSpacer" />
        {session.totalCostUsd > 0 && <span>${session.totalCostUsd.toFixed(4)}</span>}
        {session.totalDurationMs > 0 && <span>{formatDuration(session.totalDurationMs)}</span>}
      </div>
    </div>
  );
};
