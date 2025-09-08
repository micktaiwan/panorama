import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import './ChatWidget.css';

const initialMessages = [
  {
    id: 'welcome',
    role: 'assistant',
    content: "Hi 👋 I can answer about your workspace and run actions (e.g., create a task). Ask me anything.",
  },
];

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const toggleOpen = useCallback(() => {
    setIsOpen((v) => !v);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsSending(true);

    const history = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
    Meteor.call(
      'chat.ask',
      { query: trimmed, history },
      (error, result) => {
        setIsSending(false);
        if (error) {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-error`,
              role: 'assistant',
              content: `Error: ${error.reason || error.message || 'method unavailable'}`,
              error: true,
            },
          ]);
          return;
        }

        const assistantText = result?.text || "I don't have an answer yet.";
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: assistantText,
            citations: result?.citations || [],
          },
        ]);
      }
    );
  }, [input, isSending, messages]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

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
            <div className="ChatWidget__title">AI Chat</div>
            <button type="button" className="ChatWidget__close" onClick={toggleOpen} aria-label="Close">×</button>
          </div>

          <div className="ChatWidget__messages" ref={scrollRef}>
            {hasMessages ? (
              messages.map((m) => (
                <div key={m.id} className={`ChatWidget__message ChatWidget__message--${m.role} ${m.error ? 'ChatWidget__message--error' : ''}`}>
                  <div className="ChatWidget__bubble">
                    <div className="ChatWidget__content">{m.content}</div>
                    {Array.isArray(m.citations) && m.citations.length > 0 && (
                      <div className="ChatWidget__citations">
                        {m.citations.map((c, idx) => (
                          <a key={idx} className="ChatWidget__citation" href={c.url || '#'} target="_blank" rel="noreferrer">
                            {c.title || c.id || 'source'}
                          </a>
                        ))}
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


