import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import './ChatWidget.css';
import { navigateTo } from '/imports/ui/router.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { notify } from '/imports/ui/utils/notify.js';
import { useTracker } from 'meteor/react-meteor-data';
import { ChatsCollection } from '/imports/api/chats/collections';

const initialMessages = [
  {
    id: 'welcome',
    role: 'assistant',
    content: "Hi 👋 I can answer about your workspace and run actions (e.g., create a task). Ask me anything.",
  },
];

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('chat_open') === '1';
  });
  const [docked, setDocked] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('chat_docked') === '1';
  });
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState(() => "");
  const [isSending, setIsSending] = useState(false);
  const [pending, setPending] = useState([]); // local, not yet persisted
  const [expandedCitations, setExpandedCitations] = useState(() => new Set());
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Subscribe to recent persisted messages
  const historyReady = useTracker(() => Meteor.subscribe('chats.recent', 200).ready(), []);
  const historyDocs = useTracker(() => (historyReady ? ChatsCollection.find({}, { sort: { createdAt: 1 }, limit: 200 }).fetch() : []), [historyReady]);
  const renderList = useMemo(() => {
    if (Array.isArray(historyDocs) && historyDocs.length > 0) {
      const base = historyDocs.map((d) => ({ id: d._id, role: d.role, content: d.content, citations: d.citations || [], isStatus: !!d.isStatus, error: !!d.error }));
      return [...base, ...pending];
    }
    return [...messages, ...pending];
  }, [historyDocs, messages, pending]);

  const toggleOpen = useCallback(() => {
    setIsOpen((v) => !v);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    // Persist user message immediately so it appears before server status entries
    Meteor.call('chats.insert', { role: 'user', content: trimmed });
    // Show assistant placeholder only
    setPending((prev) => [...prev, { id: `${Date.now()}-assistant-pending`, role: 'assistant', content: 'Thinking…', pending: true }]);
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
        setMessages((prev) => [...prev, { id: `${Date.now()}-assistant`, role: 'assistant', content: assistantText, citations: result?.citations || [] }]);
      }
    );
  }, [input, isSending, renderList]);

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
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const shouldReserve = isOpen && docked;
    if (shouldReserve) body.classList.add(cls); else body.classList.remove(cls);
    return () => body.classList.remove(cls);
  }, [isOpen, docked]);

  // Persist state in localStorage
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('chat_open', isOpen ? '1' : '0');
  }, [isOpen]);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('chat_docked', docked ? '1' : '0');
  }, [docked]);

  // Global shortcut: ⌘D to toggle panel
  useEffect(() => {
    const onGlobalKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      if (e.metaKey && e.shiftKey && key === 'd') {
        e.preventDefault();
        setDocked((v) => !v);
        setIsOpen(true);
        return;
      }
      if (e.metaKey && key === 'd') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

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

  return (
    <div className={`ChatWidget__root${docked ? ' isDocked' : ''}`} aria-live="polite">
      <button
        type="button"
        className="ChatWidget__fab"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={toggleOpen}
        title={isOpen ? 'Close chat' : 'Open chat'}
      >
        💬
      </button>

      {isOpen && (
        <div className={`ChatWidget__panel${docked ? ' docked' : ''}`} role="dialog" aria-label="AI Chat">
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

          <div className="ChatWidget__messages" ref={scrollRef}>
            {hasMessages ? (
              renderList.map((m) => (
                <div key={m.id} className={`ChatWidget__message ChatWidget__message--${m.role} ${m.error ? 'ChatWidget__message--error' : ''}${m.isStatus ? ' ChatWidget__message--status' : ''}`}>
                  <div className="ChatWidget__bubble">
                    <div className="ChatWidget__content">{m.content}</div>
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


