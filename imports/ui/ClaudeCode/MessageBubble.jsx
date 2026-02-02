import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
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

const AskUserQuestionBlock = ({ block, onAnswer }) => {
  const questions = block.input?.questions || [];
  const [selections, setSelections] = useState({});
  const hasMultipleQuestions = questions.length > 1;

  const selectOption = (qIdx, label, isMulti) => {
    setSelections(prev => {
      if (isMulti) {
        const current = prev[qIdx] || [];
        return { ...prev, [qIdx]: current.includes(label) ? current.filter(l => l !== label) : [...current, label] };
      }
      return { ...prev, [qIdx]: [label] };
    });
  };

  const formatAndSend = () => {
    const parts = questions.map((q, qIdx) => {
      const selected = selections[qIdx] || [];
      const answer = selected.join(', ');
      return q.header ? `${q.header}: ${answer}` : answer;
    });
    onAnswer?.(parts.join('\n'));
  };

  const allAnswered = questions.every((_, qIdx) => (selections[qIdx] || []).length > 0);
  const isImmediate = questions.length === 1 && !questions[0].multiSelect;

  return (
    <div className="ccAskQuestion">
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="ccAskQuestionItem">
          {q.header && <span className="ccAskHeader">{q.header}</span>}
          <div className="ccAskText">{q.question}</div>
          <div className="ccAskOptions">
            {q.options?.map((opt, oIdx) => {
              const isSelected = (selections[qIdx] || []).includes(opt.label);
              return (
                <button
                  key={oIdx}
                  className={`ccAskOption${isSelected ? ' ccAskOption--selected' : ''}`}
                  onClick={() => isImmediate ? onAnswer?.(opt.label) : selectOption(qIdx, opt.label, q.multiSelect)}
                >
                  <span className="ccAskOptionLabel">{opt.label}</span>
                  {opt.description && <span className="ccAskDescription">{opt.description}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!isImmediate && (
        <button
          className="ccAskConfirm"
          disabled={!allAnswered}
          onClick={formatAndSend}
        >
          Send
        </button>
      )}
    </div>
  );
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

const ContentBlock = ({ block, onAnswer }) => {
  if (block.type === 'text') {
    return (
      <div
        className="ccMarkdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
      />
    );
  }
  if (block.type === 'tool_use') {
    if (block.name === 'AskUserQuestion') {
      return <AskUserQuestionBlock block={block} onAnswer={onAnswer} />;
    }
    return <ToolUseBlock block={block} />;
  }
  if (block.type === 'tool_result') {
    return <ToolResultBlock block={block} />;
  }
  return null;
};

export const ToolGroupBlock = ({ messages, autoExpanded = false, onAnswer }) => {
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
            <ContentBlock key={i} block={block} onAnswer={onAnswer} />
          ))}
        </div>
      )}
    </div>
  );
};

const PermissionActions = ({ sessionId, toolName, toolInput }) => {
  const [responded, setResponded] = useState(false);
  const [selections, setSelections] = useState({});

  const isAskQuestion = toolName === 'AskUserQuestion';
  const questions = isAskQuestion ? (toolInput?.questions || []) : [];
  const needsAnswers = questions.length > 0;
  const allAnswered = !needsAnswers || questions.every((_, qIdx) => (selections[qIdx] || []).length > 0);

  const selectOption = (qIdx, label, isMulti) => {
    setSelections(prev => {
      if (isMulti) {
        const current = prev[qIdx] || [];
        return { ...prev, [qIdx]: current.includes(label) ? current.filter(l => l !== label) : [...current, label] };
      }
      return { ...prev, [qIdx]: [label] };
    });
  };

  const handleClick = (behavior) => {
    setResponded(true);
    let updatedToolInput = null;
    if (needsAnswers && behavior !== 'deny') {
      const answers = {};
      questions.forEach((q, qIdx) => {
        const selected = selections[qIdx] || [];
        answers[String(qIdx)] = selected.join(', ');
      });
      updatedToolInput = { ...toolInput, answers };
    }
    Meteor.call('claudeSessions.respondToPermission', sessionId, behavior, updatedToolInput);
  };

  if (responded) {
    return <div className="ccPermissionActions"><span className="ccPermissionSent">Response sent</span></div>;
  }

  return (
    <div className="ccPermissionActionsWrap">
      {needsAnswers && (
        <div className="ccAskQuestion">
          {questions.map((q, qIdx) => (
            <div key={qIdx} className="ccAskQuestionItem">
              {q.header && <span className="ccAskHeader">{q.header}</span>}
              <div className="ccAskText">{q.question}</div>
              <div className="ccAskOptions">
                {q.options?.map((opt, oIdx) => {
                  const isSelected = (selections[qIdx] || []).includes(opt.label);
                  return (
                    <button
                      key={oIdx}
                      className={`ccAskOption${isSelected ? ' ccAskOption--selected' : ''}`}
                      onClick={() => selectOption(qIdx, opt.label, q.multiSelect)}
                    >
                      <span className="ccAskOptionLabel">{opt.label}</span>
                      {opt.description && <span className="ccAskDescription">{opt.description}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!allAnswered && (
            <div className="ccPermissionHint">Selectionnez vos reponses puis cliquez sur Allow</div>
          )}
        </div>
      )}
      <div className="ccPermissionActions">
        <button className="ccPermissionBtn" disabled={!allAnswered} onClick={() => handleClick('allow')}>Allow</button>
        <button className="ccPermissionBtn" disabled={!allAnswered} onClick={() => handleClick('allowAll')}>Allow All</button>
        <button className="ccPermissionBtn ccPermissionBtn--deny" onClick={() => handleClick('deny')}>Deny</button>
      </div>
    </div>
  );
};

export const MessageBubble = ({ message, onAnswer, sessionId }) => {
  const { role, content, contentText, isStreaming, usage, costUsd, durationMs } = message;
  const isUser = role === 'user';
  const isSystem = role === 'system' || message.type === 'result';
  const isPermission = message.type === 'permission_request';
  const isShell = message.type === 'shell_command' || message.type === 'shell_result';
  const blocks = Array.isArray(content) ? content : [];

  const roleLabel = isShell
    ? (message.type === 'shell_command' ? `$ ${contentText}` : 'Output')
    : isPermission ? '\u26A0 Permission Request'
    : null;

  return (
    <div className={`ccMessage ${isUser ? 'ccMessageUser' : ''} ${isSystem ? 'ccMessageSystem' : ''} ${isPermission ? 'ccMessagePermission' : ''} ${isShell ? 'ccMessageShell' : ''}`}>
      {roleLabel && <div className="ccMessageRole">{roleLabel}</div>}
      <div className="ccMessageBody">
        {isShell ? (
          message.type === 'shell_result' && <pre className="ccShellOutput">{contentText}</pre>
        ) : blocks.length > 0
          ? blocks.map((block, i) => <ContentBlock key={i} block={block} onAnswer={onAnswer} />)
          : contentText && (
            <div
              className="ccMarkdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(contentText) }}
            />
          )
        }
        {isPermission && sessionId && !message.autoResponded && <PermissionActions sessionId={sessionId} toolName={message.toolName} toolInput={message.toolInput} />}
        {isPermission && message.autoResponded && <div className="ccPermissionActions"><span className="ccPermissionSent">Auto-allowed ({message.autoRespondedMode})</span></div>}
        {isStreaming && <span className="ccCursor" />}
      </div>
    </div>
  );
};
