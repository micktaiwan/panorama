import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { marked } from 'marked';
import './ChatWidget.css';
import { navigateTo } from '/imports/ui/router.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { notify } from '/imports/ui/utils/notify.js';
import { useTracker } from 'meteor/react-meteor-data';
import { ChatsCollection } from '/imports/api/chats/collections';

// Configure marked for safe HTML output
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true     // GitHub Flavored Markdown
});

const initialMessages = [
  {
    id: 'welcome',
    role: 'assistant',
    content: "Hi 👋 I can answer about your workspace and run actions (e.g., create a task). Ask me anything.",
  },
];

const DEFAULT_DOCKED_WIDTH = 420;
const MIN_DOCKED_WIDTH = 300;

// Mode cycle order: floating -> docked -> windowed -> floating
const MODE_CYCLE = ['floating', 'docked', 'windowed'];

export default function ChatWidget({ isStandalone = false }) {
  const [isOpen, setIsOpen] = useState(() => {
    if (isStandalone) return true; // Always open in standalone mode
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('chat_open') === '1';
  });
  const [mode, setMode] = useState(() => {
    if (isStandalone) return 'windowed'; // Standalone is always windowed mode
    if (typeof localStorage === 'undefined') return 'floating';
    return localStorage.getItem('chat_mode') || 'floating';
  });
  const [dockedWidth, setDockedWidth] = useState(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_DOCKED_WIDTH;
    const saved = localStorage.getItem('chat_docked_width');
    return saved ? Math.max(MIN_DOCKED_WIDTH, parseInt(saved, 10) || DEFAULT_DOCKED_WIDTH) : DEFAULT_DOCKED_WIDTH;
  });

  // Derived state for backward compatibility
  const docked = mode === 'docked';
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState(() => "");
  const [isSending, setIsSending] = useState(false);
  const [pending, setPending] = useState([]); // local, not yet persisted
  const [expandedCitations, setExpandedCitations] = useState(() => new Set());
  const [isResizing, setIsResizing] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Subscribe to recent persisted messages
  const historyReady = useTracker(() => Meteor.subscribe('chats.recent', 200).ready(), []);
  const historyDocs = useTracker(() => (historyReady ? ChatsCollection.find({}, { sort: { createdAt: 1 }, limit: 200 }).fetch() : []), [historyReady]);
  const renderList = useMemo(() => {
    if (Array.isArray(historyDocs) && historyDocs.length > 0) {
      const base = historyDocs.map((d) => ({
        id: d._id,
        role: d.role,
        content: d.content,
        citations: d.citations || [],
        actions: d.actions || [],
        isStatus: !!d.isStatus,
        error: !!d.error
      }));
      return [...base, ...pending];
    }
    return [...messages, ...pending];
  }, [historyDocs, messages, pending]);

  const toggleOpen = useCallback(() => {
    setIsOpen((v) => !v);
  }, []);

  // Execute navigation action from chat response
  // Must be defined before handleSend which depends on it
  const executeAction = useCallback((action) => {
    if (!action || action.type !== 'navigate') return;

    switch (action.kind) {
      case 'project':
        navigateTo({ name: 'project', projectId: action.id });
        break;
      case 'session':
        navigateTo({ name: 'session', sessionId: action.id });
        break;
      case 'note':
        // Notes are viewed within their project
        navigateTo({ name: 'project', projectId: action.id });
        break;
      case 'alarms':
        navigateTo({ name: 'alarms' });
        break;
      case 'emails':
        navigateTo({ name: 'emails' });
        break;
      case 'preferences':
        navigateTo({ name: 'preferences' });
        break;
      default:
        console.warn('[ChatWidget] Unknown action kind:', action.kind);
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    // Persist user message immediately so it appears before server status entries
    Meteor.call('chats.insert', { role: 'user', content: trimmed });
    setInput('');
    setIsSending(true);

    const history = [...renderList, { role: 'user', content: trimmed }].map((m) => ({ role: m.role, content: m.content }));
    Meteor.call(
      'chat.ask',
      { query: trimmed, history },
      (error, result) => {
        setIsSending(false);
        // Clear pending placeholders
        setPending([]);
        if (error) {
          const detail = (typeof error.details === 'string' && error.details.trim()) ? error.details.trim() : '';
          const msg = [error.reason || error.message || 'method unavailable', detail].filter(Boolean).join(' — ');
          setMessages((prev) => [...prev, { id: `${Date.now()}-error`, role: 'assistant', content: `Error: ${msg}` , error: true }]);
          return;
        }

        const assistantText = result?.text || "I don't have an answer yet.";
        const resultActions = result?.actions || [];

        setMessages((prev) => [...prev, {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content: assistantText,
          citations: result?.citations || [],
          actions: resultActions
        }]);

        // Execute navigation actions automatically
        if (resultActions.length > 0) {
          const navAction = resultActions.find(a => a.type === 'navigate');
          if (navAction) {
            executeAction(navAction);
          }
        }
      }
    );
  }, [input, isSending, renderList, executeAction]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const hasMessages = useMemo(() => renderList.length > 0, [renderList.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Auto-scroll to bottom on new messages/pending
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [renderList.length, isSending]);

  // When docked and open, reserve space on the right so content is not hidden
  useEffect(() => {
    const cls = 'withDockedChat';
    const clsWide = 'chatWide';
    const WIDE_THRESHOLD = 500; // px - container goes 100% width above this
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const shouldReserve = isOpen && docked;
    if (shouldReserve) {
      body.classList.add(cls);
      body.style.setProperty('--docked-chat-width', `${dockedWidth}px`);
      // Force container to 100% when chat is wide
      if (dockedWidth >= WIDE_THRESHOLD) {
        body.classList.add(clsWide);
      } else {
        body.classList.remove(clsWide);
      }
    } else {
      body.classList.remove(cls);
      body.classList.remove(clsWide);
      body.style.removeProperty('--docked-chat-width');
    }
    return () => {
      body.classList.remove(cls);
      body.classList.remove(clsWide);
      body.style.removeProperty('--docked-chat-width');
    };
  }, [isOpen, docked, dockedWidth]);

  // Persist state in localStorage
  useEffect(() => {
    if (isStandalone) return; // Don't persist in standalone mode
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('chat_open', isOpen ? '1' : '0');
  }, [isOpen, isStandalone]);
  useEffect(() => {
    if (isStandalone) return; // Don't persist in standalone mode
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('chat_mode', mode);
  }, [mode, isStandalone]);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('chat_docked_width', String(dockedWidth));
  }, [dockedWidth]);

  // Resize handler for docked mode
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = dockedWidth;

    const onMouseMove = (moveEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(MIN_DOCKED_WIDTH, startWidth + delta);
      setDockedWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [dockedWidth]);

  // Cycle through modes: floating -> docked -> windowed -> floating
  const cycleMode = useCallback(async () => {
    const currentIndex = MODE_CYCLE.indexOf(mode);
    let nextIndex = (currentIndex + 1) % MODE_CYCLE.length;
    let nextMode = MODE_CYCLE[nextIndex];

    // Skip windowed mode if not in Electron
    if (nextMode === 'windowed' && !window.electron?.chatOpenWindow) {
      nextIndex = (nextIndex + 1) % MODE_CYCLE.length;
      nextMode = MODE_CYCLE[nextIndex];
    }

    // Handle windowed mode transitions
    if (nextMode === 'windowed') {
      await window.electron.chatOpenWindow();
    } else if (mode === 'windowed') {
      // Leaving windowed mode - close the chat window
      window.electron?.chatCloseWindow?.();
    }

    setMode(nextMode);
    setIsOpen(true);
  }, [mode]);

  // Listen for chat window closed event (when user closes external window)
  useEffect(() => {
    if (isStandalone) return;
    if (!window.electron?.onChatWindowClosed) return;

    const cleanup = window.electron.onChatWindowClosed(() => {
      // When chat window is closed, switch back to floating mode
      setMode('floating');
      setIsOpen(true);
    });

    return cleanup;
  }, [isStandalone]);

  // Global shortcut: ⌘L to toggle panel, ⌘⇧L to cycle modes
  useEffect(() => {
    if (isStandalone) return; // Don't handle shortcuts in standalone window

    const onGlobalKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      if (e.metaKey && e.shiftKey && key === 'l') {
        e.preventDefault();
        cycleMode();
        return;
      }
      if (e.metaKey && key === 'l') {
        e.preventDefault();
        // In windowed mode, Cmd+L focuses the chat window
        if (mode === 'windowed') {
          window.electron?.chatFocusWindow?.();
        } else {
          setIsOpen((v) => !v);
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [cycleMode, mode, isStandalone]);

  const onClickCitation = useCallback((c) => {
    if (!c) return;
    if (c.kind === 'project' && c.id) {
      const id = String(c.id).split(':').pop();
      navigateTo({ name: 'project', projectId: id });
      return;
    }
    if (c.kind === 'task' && c.projectId) {
      navigateTo({ name: 'project', projectId: c.projectId });
      return;
    }
    if (c.kind === 'note' && c.projectId) {
      navigateTo({ name: 'project', projectId: c.projectId });
      return;
    }
    if (c.kind === 'session' && c.id) {
      const id = String(c.id).split(':').pop();
      navigateTo({ name: 'session', sessionId: id });
      return;
    }
    if (c.kind === 'alarm') {
      navigateTo({ name: 'alarms' });
      return;
    }
    if (c.kind === 'link' && c.url) {
      window.location.href = c.url;
      return;
    }
    // Fallback
    navigateTo({ name: 'home' });
  }, []);

  const toggleCitations = useCallback((msgId) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  }, []);

  const buildTranscript = useCallback(() => {
    const lines = (renderList || []).map((m) => {
      const role = (m && m.role) ? String(m.role) : 'assistant';
      const content = (m && m.content) ? String(m.content) : '';
      return `${role}: ${content}`;
    });
    return lines.join('\n\n');
  }, [renderList]);

  const handleCopyTranscript = useCallback(async () => {
    const text = buildTranscript();
    await writeClipboard(text);
    notify({ message: 'Transcript copied to clipboard', kind: 'success' });
  }, [buildTranscript]);

  const handleCopyMessage = useCallback(async (text) => {
    const toCopy = (typeof text === 'string') ? text : String(text || '');
    await writeClipboard(toCopy);
  }, []);

  // In windowed mode (main window), don't render anything - chat is in external window
  if (mode === 'windowed' && !isStandalone) {
    return null;
  }

  // Standalone mode: render full-screen chat without toggle
  if (isStandalone) {
    return (
      <div className="ChatWidget__standalone" aria-live="polite">
        <div className="ChatWidget__panel standalone" role="dialog" aria-label="AI Chat">
          <div className="ChatWidget__header">
            <div className="ChatWidget__title">AI Chat {isSending ? <span className="muted">· Sending…</span> : null}</div>
            <div>
              <button type="button" className="ChatWidget__close" onClick={handleCopyTranscript} aria-label="Copy transcript" title="Copy transcript">⧉</button>
              <button type="button" className="ChatWidget__close" onClick={() => {
                setPending([]);
                Meteor.call('chats.clear');
              }} aria-label="Clear" title="Clear chat">⟲</button>
            </div>
          </div>

          <div className="ChatWidget__messages scrollArea" ref={scrollRef}>
            {hasMessages ? (
              renderList.map((m) => (
                <div key={m.id} className={`ChatWidget__message ChatWidget__message--${m.role} ${m.error ? 'ChatWidget__message--error' : ''}${m.isStatus ? ' ChatWidget__message--status' : ''}`}>
                  <div className="ChatWidget__bubble">
                    <div
                      className="ChatWidget__content aiMarkdown"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '') }}
                    />
                    {Array.isArray(m.citations) && m.citations.length > 0 && (
                      <div className="ChatWidget__sourcesBlock">
                        {!expandedCitations.has(m.id) ? (
                          <button className="ChatWidget__toggleCitations" onClick={() => toggleCitations(m.id)}>Show sources</button>
                        ) : (
                          <>
                            <div className="ChatWidget__citations">
                              {m.citations.map((c, idx) => (
                                <button key={idx} className="ChatWidget__citation" onClick={() => onClickCitation(c)}>
                                  {c.title || c.id || 'source'}
                                </button>
                              ))}
                            </div>
                            <button className="ChatWidget__toggleCitations" onClick={() => toggleCitations(m.id)}>Hide sources</button>
                          </>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && !m.isStatus ? (
                      <div className="ChatWidget__actions">
                        <button
                          type="button"
                          className="ChatWidget__iconBtn"
                          onClick={() => handleCopyMessage(m.content)}
                          aria-label="Copy reply"
                          title="Copy reply"
                        >
                          ⧉
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="ChatWidget__empty">No messages yet.</div>
            )}
          </div>

          <div className="ChatWidget__composer">
            <textarea
              className="ChatWidget__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask your question… (Enter to send, Shift+Enter for new line)"
              rows={2}
              ref={inputRef}
            />
          </div>
        </div>
      </div>
    );
  }

  // Normal floating/docked mode
  return (
    <div className={`ChatWidget__root${docked ? ' isDocked' : ''}${isResizing ? ' isResizing' : ''}`} aria-live="polite">
      {isOpen && (
        <div
          className={`ChatWidget__panel${docked ? ' docked' : ''}`}
          role="dialog"
          aria-label="AI Chat"
          style={docked ? { width: `${dockedWidth}px` } : undefined}
        >
          {docked && (
            <div
              className="ChatWidget__resizeHandle"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            />
          )}
          <div className="ChatWidget__header">
            <div className="ChatWidget__title">AI Chat {isSending ? <span className="muted">· Sending…</span> : null}</div>
            <div>
              <button type="button" className="ChatWidget__close" onClick={handleCopyTranscript} aria-label="Copy transcript" title="Copy transcript">⧉</button>
              <button type="button" className="ChatWidget__close" onClick={() => {
                setPending([]);
                Meteor.call('chats.clear');
              }} aria-label="Clear" title="Clear chat">⟲</button>
              <button type="button" className="ChatWidget__close" onClick={toggleOpen} aria-label="Close">×</button>
            </div>
          </div>

          <div className="ChatWidget__messages scrollArea" ref={scrollRef}>
            {hasMessages ? (
              renderList.map((m) => (
                <div key={m.id} className={`ChatWidget__message ChatWidget__message--${m.role} ${m.error ? 'ChatWidget__message--error' : ''}${m.isStatus ? ' ChatWidget__message--status' : ''}`}>
                  <div className="ChatWidget__bubble">
                    <div
                      className="ChatWidget__content aiMarkdown"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '') }}
                    />
                    {Array.isArray(m.citations) && m.citations.length > 0 && (
                      <div className="ChatWidget__sourcesBlock">
                        {!expandedCitations.has(m.id) ? (
                          <button className="ChatWidget__toggleCitations" onClick={() => toggleCitations(m.id)}>Show sources</button>
                        ) : (
                          <>
                            <div className="ChatWidget__citations">
                              {m.citations.map((c, idx) => (
                                <button key={idx} className="ChatWidget__citation" onClick={() => onClickCitation(c)}>
                                  {c.title || c.id || 'source'}
                                </button>
                              ))}
                            </div>
                            <button className="ChatWidget__toggleCitations" onClick={() => toggleCitations(m.id)}>Hide sources</button>
                          </>
                        )}
                      </div>
                    )}
                    {m.role === 'assistant' && !m.isStatus ? (
                      <div className="ChatWidget__actions">
                        <button
                          type="button"
                          className="ChatWidget__iconBtn"
                          onClick={() => handleCopyMessage(m.content)}
                          aria-label="Copy reply"
                          title="Copy reply"
                        >
                          ⧉
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="ChatWidget__empty">No messages yet.</div>
            )}
          </div>

          <div className="ChatWidget__composer">
            <textarea
              className="ChatWidget__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask your question… (Enter to send, Shift+Enter for new line)"
              rows={2}
              ref={inputRef}
            />
          </div>
        </div>
      )}
    </div>
  );
}


