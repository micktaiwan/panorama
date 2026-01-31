import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import './MessageBubble.css';

const renderMarkdown = (text) => {
  if (!text) return '';
  return marked.parse(text, { breaks: true });
};

const basename = (path) => path?.split('/').pop() || path;
const truncate = (str, max) => str?.length > max ? str.slice(0, max) + '\u2026' : str;

const formatToolLabel = (block) => {
  const name = block.name || 'tool';
  const input = block.input || {};

  switch (name) {
    case 'Read':
      return input.file_path ? `Read: ${basename(input.file_path)}` : 'Read';
    case 'Grep':
      return input.pattern ? `Grep: "${truncate(input.pattern, 30)}"` : 'Grep';
    case 'Glob':
      return input.pattern ? `Glob: ${truncate(input.pattern, 30)}` : 'Glob';
    case 'Bash':
      return input.command ? `Bash: ${truncate(input.command, 40)}` : 'Bash';
    case 'Edit':
      return input.file_path ? `Edit: ${basename(input.file_path)}` : 'Edit';
    case 'Write':
      return input.file_path ? `Write: ${basename(input.file_path)}` : 'Write';
    case 'Task':
      return input.description ? `Task: ${truncate(input.description, 30)}` : 'Task';
    case 'WebFetch':
      return input.url ? `WebFetch: ${truncate(input.url, 40)}` : 'WebFetch';
    case 'WebSearch':
      return input.query ? `WebSearch: "${truncate(input.query, 30)}"` : 'WebSearch';
    default:
      return name;
  }
};

const ToolUseBlock = ({ block }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ccToolUse">
      <button className="ccToolUseToggle" onClick={() => setExpanded(!expanded)}>
        <span className="ccToolIcon">&#9881;</span>
        <span className="ccToolName">{formatToolLabel(block)}</span>
        <span className="ccToolChevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <pre className="ccToolInput">{JSON.stringify(block.input, null, 2)}</pre>
      )}
    </div>
  );
};

const ToolResultBlock = ({ block }) => {
  const [expanded, setExpanded] = useState(false);
  const text = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
      ? block.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      : JSON.stringify(block.content);

  return (
    <div className="ccToolResult">
      <button className="ccToolUseToggle" onClick={() => setExpanded(!expanded)}>
        <span className="ccToolIcon">&#8629;</span>
        <span className="ccToolName">result</span>
        <span className="ccToolChevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <pre className="ccToolInput">{text}</pre>
      )}
    </div>
  );
};

const ContentBlock = ({ block }) => {
  if (block.type === 'text') {
    return (
      <div
        className="ccMarkdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
      />
    );
  }
  if (block.type === 'tool_use') {
    return <ToolUseBlock block={block} />;
  }
  if (block.type === 'tool_result') {
    return <ToolResultBlock block={block} />;
  }
  return null;
};

export const ToolGroupBlock = ({ messages, autoExpanded = false }) => {
  const [userToggled, setUserToggled] = useState(false);
  const [expanded, setExpanded] = useState(autoExpanded);

  // Follow autoExpanded unless user has manually toggled
  useEffect(() => {
    if (!userToggled) {
      setExpanded(autoExpanded);
    }
  }, [autoExpanded, userToggled]);

  const toggle = () => {
    setUserToggled(true);
    setExpanded(prev => !prev);
  };

  const toolLabels = messages.flatMap(msg =>
    (Array.isArray(msg.content) ? msg.content : [])
      .filter(b => b.type === 'tool_use')
      .map(b => formatToolLabel(b))
  );

  const allBlocks = messages.flatMap(msg =>
    Array.isArray(msg.content) ? msg.content : []
  );

  return (
    <div className={`ccToolGroup ${autoExpanded ? 'ccToolGroup--active' : ''}`}>
      <button className="ccToolGroupHeader" onClick={toggle}>
        <span className="ccToolGroupIcon">&#9881;</span>
        <span className="ccToolGroupNames">{toolLabels.length > 0 ? toolLabels.join(' \u00B7 ') : 'Tools'}</span>
        <span className="ccToolChevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <div className="ccToolGroupDetails">
          {allBlocks.map((block, i) => (
            <ContentBlock key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
};

export const MessageBubble = ({ message }) => {
  const { role, content, contentText, isStreaming, usage, costUsd, durationMs } = message;
  const isUser = role === 'user';
  const isSystem = role === 'system' || message.type === 'result';
  const blocks = Array.isArray(content) ? content : [];

  return (
    <div className={`ccMessage ${isUser ? 'ccMessageUser' : ''} ${isSystem ? 'ccMessageSystem' : ''}`}>
      <div className="ccMessageRole">{isUser ? 'You' : 'Claude'}</div>
      <div className="ccMessageBody">
        {blocks.length > 0
          ? blocks.map((block, i) => <ContentBlock key={i} block={block} />)
          : contentText && (
            <div
              className="ccMarkdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(contentText) }}
            />
          )
        }
        {isStreaming && <span className="ccCursor" />}
      </div>
      {(usage || costUsd != null || durationMs != null) && (
        <div className="ccMessageMeta">
          {usage && <span>in:{usage.input_tokens} out:{usage.output_tokens}</span>}
          {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
          {durationMs != null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
        </div>
      )}
    </div>
  );
};
