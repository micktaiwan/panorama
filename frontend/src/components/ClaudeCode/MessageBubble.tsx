import { useState } from 'react';
import { marked } from 'marked';
import { claudeCode } from '../../services/api';
import type { ClaudeMessage, ClaudeContentBlock } from '../../types';
import './MessageBubble.css';

const renderMarkdown = (text: string): string => {
  if (!text) return '';
  return marked.parse(text, { breaks: true }) as string;
};

const basename = (p: string) => p?.split('/').pop() || p;

function formatToolLabel(block: ClaudeContentBlock): string {
  const name = block.name || 'tool';
  const input = block.input || {};
  switch (name) {
    case 'Read': return input.file_path ? `Read: ${basename(input.file_path as string)}` : 'Read';
    case 'Grep': return input.pattern ? `Grep: "${input.pattern}"` : 'Grep';
    case 'Glob': return input.pattern ? `Glob: ${input.pattern}` : 'Glob';
    case 'Bash': return input.command ? `Bash: ${(input.command as string).slice(0, 60)}` : 'Bash';
    case 'Edit': return input.file_path ? `Edit: ${basename(input.file_path as string)}` : 'Edit';
    case 'Write': return input.file_path ? `Write: ${basename(input.file_path as string)}` : 'Write';
    case 'Task': return input.description ? `Task: ${input.description}` : 'Task';
    case 'WebFetch': return input.url ? `WebFetch: ${input.url}` : 'WebFetch';
    case 'WebSearch': return input.query ? `WebSearch: "${input.query}"` : 'WebSearch';
    default: return name;
  }
}

function ToolUseBlock({ block }: { block: ClaudeContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="cc-tool-use">
      <button className="cc-tool-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="cc-tool-icon">{'\u2699'}</span>
        <span className="cc-tool-name">{formatToolLabel(block)}</span>
        <span className="cc-tool-chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && <pre className="cc-tool-input">{JSON.stringify(block.input, null, 2)}</pre>}
    </div>
  );
}

function ToolResultBlock({ block }: { block: ClaudeContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
      ? (block.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('\n')
      : JSON.stringify(block.content);

  return (
    <div className="cc-tool-result">
      <button className="cc-tool-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="cc-tool-icon">{'\u21A9'}</span>
        <span className="cc-tool-name">result</span>
        <span className="cc-tool-chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && <pre className="cc-tool-input">{text}</pre>}
    </div>
  );
}

function ImageBlock({ block }: { block: ClaudeContentBlock }) {
  const src = block.source?.type === 'base64'
    ? `data:${block.source.media_type};base64,${block.source.data}`
    : null;
  if (!src) return null;
  return <img className="cc-image-block" src={src} alt="Attached" onClick={() => window.open(src, '_blank')} />;
}

function ContentBlock({ block }: { block: ClaudeContentBlock }) {
  if (block.type === 'text') {
    return <div className="cc-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text || '') }} />;
  }
  if (block.type === 'image') return <ImageBlock block={block} />;
  if (block.type === 'tool_use') return <ToolUseBlock block={block} />;
  if (block.type === 'tool_result') return <ToolResultBlock block={block} />;
  return null;
}

function PermissionActions({ sessionId, toolInput }: { sessionId: string; toolInput: Record<string, unknown> }) {
  const [responded, setResponded] = useState(false);

  const handleClick = async (behavior: string) => {
    setResponded(true);
    try {
      await claudeCode.respondPermission(sessionId, behavior, toolInput);
    } catch (err) {
      console.error('Permission response failed:', err);
    }
  };

  if (responded) {
    return <div className="cc-perm-actions"><span className="cc-perm-sent">Response sent</span></div>;
  }

  return (
    <div className="cc-perm-actions">
      <button className="cc-perm-btn" onClick={() => handleClick('allow')}>Allow</button>
      <button className="cc-perm-btn" onClick={() => handleClick('allowAll')}>Allow All</button>
      <button className="cc-perm-btn cc-perm-deny" onClick={() => handleClick('deny')}>Deny</button>
    </div>
  );
}

// Tool group: collapsible group of tool-only messages
export function ToolGroupBlock({ messages }: { messages: ClaudeMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  const toolLabels = messages.flatMap(msg =>
    (Array.isArray(msg.content) ? msg.content : [])
      .filter(b => b.type === 'tool_use')
      .map(b => formatToolLabel(b))
  );

  const allBlocks = messages.flatMap(msg => Array.isArray(msg.content) ? msg.content : []);

  return (
    <div className="cc-tool-group">
      <button className="cc-tool-group-header" onClick={() => setExpanded(!expanded)}>
        <span className="cc-tool-icon">{'\u2699'}</span>
        <span className="cc-tool-group-names">{toolLabels.join(' \u00B7 ')}</span>
        <span className="cc-tool-chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <div className="cc-tool-group-details">
          {allBlocks.map((block, i) => <ContentBlock key={i} block={block} />)}
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: ClaudeMessage;
  sessionId: string;
}

export function MessageBubble({ message, sessionId }: MessageBubbleProps) {
  const { role, content, contentText, isStreaming } = message;
  const isUser = role === 'user';
  const isPermission = message.type === 'permission_request';
  const isShell = message.type === 'shell_command' || message.type === 'shell_result';
  const isError = message.type === 'error';
  const blocks = Array.isArray(content) ? content : [];

  const roleLabel = isShell
    ? (message.type === 'shell_command' ? `$ ${contentText}` : 'Output')
    : isPermission ? '\u26A0 Permission Request'
    : null;

  return (
    <div className={`cc-message ${isUser ? 'cc-msg-user' : ''} ${isPermission ? 'cc-msg-permission' : ''} ${isShell ? 'cc-msg-shell' : ''} ${isError ? 'cc-msg-error' : ''}`}>
      {roleLabel && <div className="cc-msg-role">{roleLabel}</div>}
      <div className="cc-msg-body">
        {isShell ? (
          message.type === 'shell_result' && <pre className="cc-shell-output">{contentText}</pre>
        ) : blocks.length > 0
          ? blocks.map((block, i) => <ContentBlock key={i} block={block} />)
          : contentText && <div className="cc-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(contentText) }} />
        }
        {isPermission && !message.autoResponded && (
          <PermissionActions sessionId={sessionId} toolInput={message.toolInput || {}} />
        )}
        {isPermission && message.autoResponded && (
          <div className="cc-perm-actions"><span className="cc-perm-sent">Auto-allowed ({message.autoRespondedMode})</span></div>
        )}
        {isStreaming && <span className="cc-cursor" />}
      </div>
    </div>
  );
}
