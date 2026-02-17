import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { MessageBubble } from '/imports/ui/ClaudeCode/MessageBubble.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import './AskAiSidebar.css';

export const AskAiSidebar = ({ sessionId, onClose, getNoteContent, getSelectedText, onReplace, onInsertBelow }) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const { messages, session } = useTracker(() => {
    Meteor.subscribe('claudeMessages.bySession', sessionId);
    Meteor.subscribe('claudeSessions');
    return {
      messages: ClaudeMessagesCollection.find({ sessionId }, { sort: { createdAt: 1 } }).fetch(),
      session: ClaudeSessionsCollection.findOne(sessionId),
    };
  }, [sessionId]);

  const isRunning = session?.status === 'running';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, messages[messages.length - 1]?.contentText]);

  // Focus textarea on mount (slight delay — session creation is async)
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  const handleSend = () => {
    const prompt = input.trim();
    if (!prompt || isRunning) return;

    const noteContent = getNoteContent();
    const selectedText = getSelectedText();

    const parts = ['## Full note', noteContent || '(empty)'];
    if (selectedText) {
      parts.push('', '## Selected text', selectedText);
    }
    parts.push('', '## Request', prompt);

    const fullMessage = parts.join('\n');
    Meteor.call('claudeSessions.sendMessage', sessionId, fullMessage);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => {
    Meteor.call('claudeSessions.remove', sessionId);
    onClose();
  };

  const getAssistantText = (message) => {
    if (message.contentText) return message.contentText;
    if (Array.isArray(message.content)) {
      return message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
    }
    return '';
  };

  const toDisplayMessage = (msg) => {
    if (msg.role !== 'user') return msg;
    const text = msg.contentText || '';
    const match = text.match(/## Request\n([\s\S]*)$/);
    if (!match) return msg;
    const short = match[1].trim();
    return { ...msg, contentText: short, content: [{ type: 'text', text: short }] };
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    notify({ message: 'Copied to clipboard', kind: 'success' });
  };

  return (
    <div className="ask-ai-sidebar">
      <div className="ask-ai-header">
        <span className="ask-ai-title">Ask AI</span>
        <button className="ask-ai-close" onClick={handleClose} title="Close sidebar">
          &times;
        </button>
      </div>

      <div className="ask-ai-messages scrollArea">
        {messages.length === 0 && (
          <div className="ask-ai-empty">
            Select text and ask a question about your note.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg._id} className="ask-ai-msg-wrapper">
            <MessageBubble message={toDisplayMessage(msg)} />
            {msg.role === 'assistant' && !msg.isStreaming && (
              <div className="ask-ai-actions">
                <button
                  className="ask-ai-action-btn"
                  onClick={() => onReplace(getAssistantText(msg))}
                  title="Replace selected text"
                >
                  Replace
                </button>
                <button
                  className="ask-ai-action-btn"
                  onClick={() => onInsertBelow(getAssistantText(msg))}
                  title="Insert below selection"
                >
                  Insert below
                </button>
                <button
                  className="ask-ai-action-btn"
                  onClick={() => handleCopy(getAssistantText(msg))}
                  title="Copy to clipboard"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        ))}
        {isRunning && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="ask-ai-typing">
            <span className="ask-ai-dot" />
            <span className="ask-ai-dot" />
            <span className="ask-ai-dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ask-ai-composer">
        <textarea
          ref={textareaRef}
          className="ask-ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Waiting for response...' : 'Ask about your note...'}
          disabled={isRunning}
          rows={2}
        />
        <button
          className="ask-ai-send"
          onClick={handleSend}
          disabled={!input.trim() || isRunning}
          title="Send (Enter)"
        >
          Send
        </button>
      </div>
    </div>
  );
};

AskAiSidebar.propTypes = {
  sessionId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  getNoteContent: PropTypes.func.isRequired,
  getSelectedText: PropTypes.func.isRequired,
  onReplace: PropTypes.func.isRequired,
  onInsertBelow: PropTypes.func.isRequired,
};
