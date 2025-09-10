import React, { useState, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { useSingle } from '/imports/ui/hooks/useSingle.js';
import { useDoc } from '/imports/ui/hooks/useDoc.js';
import { navigateTo } from '/imports/ui/router.js';
import { timeAgo, formatDate } from '/imports/ui/utils/date.js';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import './NoteSession.css';
import { marked } from 'marked';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';

export const NoteSession = ({ sessionId, onBack }) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const notesListRef = useRef(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isCoaching, setIsCoaching] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeStatus, setFinalizeStatus] = useState(null); // 'ok' | 'err' | null
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const load = useSubscribe('noteLines');
  const loadSession = useSubscribe('noteSessions');
  const loadProjects = useSubscribe('projects');
  const loadTasks = useSubscribe('tasks');
  const loadNotes = useSubscribe('notes');

  const session = useSingle(() => NoteSessionsCollection.find({ _id: sessionId }));
  const lines = useFind(() => NoteLinesCollection.find({ sessionId }, { sort: { createdAt: 1 } }));
  // Always call useFind in the same order; use a neutral selector when no projectId
  // Resolve project reactively by ID to avoid any cursor mishaps.
  const project = useDoc(() => (session && session.projectId ? ProjectsCollection.findOne({ _id: session.projectId }) : null));
  const allProjects = useFind(() => ProjectsCollection.find({}, { sort: { updatedAt: -1 }, fields: { name: 1 } }));
  const pid = session && session.projectId ? session.projectId : '__none__';
  const openTasks = useFind(() => (
    TasksCollection.find(
      { projectId: pid, $or: [ { status: { $exists: false } }, { status: { $ne: 'done' } } ] },
      { sort: { deadline: 1, createdAt: 1 } }
    )
  ), [pid]);
  const projectNotes = useFind(() => (
    NotesCollection.find(
      { projectId: pid },
      { sort: { createdAt: -1 } }
    )
  ), [pid]);

  const hasLines = Array.isArray(lines) && lines.length > 0;

  const mdToPlain = (markdown) => {
    if (!markdown) return '';
    let s = markdown;
    // Remove fenced code markers but keep inner text
    s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
    // Strip headings markers
    s = s.replace(/^#{1,6}\s*/gm, '');
    // Emphasis and code
    s = s.replace(/\*\*(.*?)\*\*/g, '$1');
    s = s.replace(/\*(.*?)\*/g, '$1');
    s = s.replace(/_(.*?)_/g, '$1');
    s = s.replace(/`([^`]*)`/g, '$1');
    // Links [text](url) -> text (url)
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
    // Collapse excessive blank lines
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  };

  const onCommitLine = () => {
    const content = inputValue.trim();
    if (content.length === 0) return;
    const prev = inputValue;
    Meteor.call('noteLines.insert', { sessionId, content }, (err, res) => {
      if (err) {
        // If vectorization failed, we keep the input but inform the user that data was saved
        if (err && err.error === 'vectorization-failed' && err.details && err.details.insertedId) {
          notify({ message: 'Saved, but search indexing failed.', kind: 'warning' });
          setInputValue('');
          return;
        }
        console.error('noteLines.insert failed', err);
        notify({ message: 'Failed to save note line. Data kept. Check connection.', kind: 'error' });
        setInputValue(prev);
        return;
      }
      setInputValue('');
    });
    inputRef.current?.focus();
  };

  // Keep notes list scrolled to bottom when new lines are added
  useEffect(() => {
    if (notesListRef.current) {
      notesListRef.current.scrollTop = notesListRef.current.scrollHeight;
    }
  }, [lines.length]);

  const isLoading = load() || loadSession() || loadProjects() || loadTasks() || loadNotes();

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="noteSessionGrid">
      <div className="contextColumn">
        <button
          className="btn"
          onClick={() => {
            if (session && session.projectId) {
              navigateTo({ name: 'project', projectId: session.projectId });
            } else {
              onBack();
            }
          }}
        >
          Back
        </button>
        <h3>Context</h3>
        {project ? (
          <div>
            <div className="contextSection">
              <div className="contextTitle">Metadata</div>
              <div className="contextMeta">Name: {project.name || '(untitled project)'}<br />Status: {project.status || 'n/a'}<br />Target: {project.targetDate ? formatDate(project.targetDate) : 'n/a'}</div>
            </div>
            <div className="contextSection">
              <div className="contextTitle">Open tasks {openTasks.length > 0 ? `(${openTasks.length})` : ''}</div>
              {openTasks.length === 0 ? (
                <div className="contextEmpty">No open tasks</div>
              ) : (
                <ul className="contextList">
                  {openTasks.map(t => (
                    <li key={t._id}>
                      <span className="truncateOneLine">{t.title || '(untitled task)'}{t.deadline ? ` — ${new Date(t.deadline).toLocaleDateString()}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="contextSection">
              <div className="contextTitle">Recent notes {projectNotes.length > 0 ? `(${projectNotes.length})` : ''}</div>
              {projectNotes.length === 0 ? (
                <div className="contextEmpty">No notes</div>
              ) : (
                <ul className="contextList">
                  {projectNotes.slice(0, 3).map(n => (
                    <li key={n._id}>
                      <Tooltip content={<pre className="tooltipPre">{n.content}</pre>} placement="right" size="large">
                        <span className="truncateOneLine" title={new Date(n.createdAt).toLocaleString()}>{n.title && n.title.trim() ? n.title : '(untitled note)'}</span>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="contextEmpty">No project linked</div>
            <div className="contextSection linkProjectSection">
              <label htmlFor="linkProjectSelect" className="contextTitle">Link to project</label>
              <select
                id="linkProjectSelect"
                className="linkProjectSelect"
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  Meteor.call('noteSessions.update', sessionId, { projectId: val });
                }}
                defaultValue=""
              >
                <option value="" disabled>Select project…</option>
                {allProjects.map(p => (
                  <option key={p._id} value={p._id}>{p.name || '(untitled project)'}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="notesColumn">
        <div className="sessionHeader">
          <InlineEditable
            value={(session && session.name) || ''}
            placeholder="(unnamed session)"
            onSubmit={(next) => {
              const name = (next || '').trim();
              Meteor.call('noteSessions.update', sessionId, { name });
            }}
            fullWidth
            inputClassName="sessionNameInput"
          />
        </div>
        <h3>Notes</h3>
        <ul className="notesList scrollArea" ref={notesListRef}>
          {lines.map((l, idx) => (
            <li key={l._id}>
              <div className="noteLineRow">
                <span className="noteLineNumber">L{idx + 1}</span>
              <InlineEditable
                value={l.content}
                placeholder="(empty)"
                onSubmit={(next) => {
                  const oldVal = l.content;
                  Meteor.call('noteLines.update', l._id, { content: next }, (err, res) => {
                    if (err) {
                      if (err && err.error === 'vectorization-failed') {
                        notify({ message: 'Updated, but search indexing failed.', kind: 'warning' });
                      } else {
                        console.error('noteLines.update failed', err);
                        notify({ message: 'Failed to update line. Keeping previous value.', kind: 'error' });
                        Meteor.call('noteLines.update', l._id, { content: oldVal });
                        return;
                      }
                    }
                  });
                }}
              />
                <span className="noteLineActions">
                  <button
                    className="iconButton"
                    title="Delete line"
                    onClick={() => {
                      Meteor.call('noteLines.remove', l._id, (err, res) => {
                        if (err) {
                          if (err && err.error === 'search-delete-failed') {
                            notify({ message: 'Deleted, but search index cleanup failed.', kind: 'warning' });
                          } else {
                            console.error('noteLines.remove failed', err);
                            notify({ message: 'Failed to delete line.', kind: 'error' });
                            return;
                          }
                        }
                      });
                    }}
                  >
                    🗑
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onCommitLine();
            }
          }}
          className="noteInput"
          placeholder="Type a line and press Enter"
        />
      </div>

      <div className="aiSection">
        <div className="aiHeader">
          <h3>AI</h3>
          <div className="aiHeaderActions">
            <button
              className="btn btn-primary"
              disabled={isCoaching || !hasLines}
              onClick={() => {
                setIsCoaching(true);
                Meteor.call('ai.coachQuestions', sessionId, (err, res) => {
                  setIsCoaching(false);
                  if (err) {
                    console.error('ai.coachQuestions failed', err);
                  }
                });
              }}
              title={!hasLines ? 'Add at least one line to ask Coach' : undefined}
            >
              {isCoaching ? 'Asking…' : 'Ask Coach'}
            </button>
            <Tooltip content="Clear coach items (questions, ideas, answers) for this session" placement="top">
              <button
                className="btn ml8"
                onClick={() => {
                  Meteor.call('noteSessions.clearCoach', sessionId, (err) => {
                    if (err) {
                      console.error('noteSessions.clearCoach failed', err);
                    }
                  });
                }}
                disabled={!session || !hasLines || (!session.coachQuestions && !session.coachQuestionsJson && !session.coachIdeasJson && !session.coachAnswersJson)}
                title={!session || !hasLines
                  ? 'Add at least one line to manage coach items'
                  : (!session.coachQuestions && !session.coachQuestionsJson && !session.coachIdeasJson && !session.coachAnswersJson)
                    ? 'No coach items to clear'
                    : 'Clear coach items'}
              >
                Clear Coach
              </button>
            </Tooltip>
            <button
              className="btn ml8"
              disabled={isSummarizing || !hasLines}
              onClick={() => {
                setIsSummarizing(true);
                Meteor.call('ai.summarizeSession', sessionId, (err, res) => {
                  setIsSummarizing(false);
                  if (err) {
                    console.error('ai.summarizeSession failed', err);
                  }
                });
              }}
              title={!hasLines ? 'Add at least one line to summarize' : undefined}
            >
              {isSummarizing ? 'Summarizing…' : 'Summarize'}
            </button>
            <button
              className={`btn ml8 ${isEditingSummary ? 'success' : ''}`}
              onClick={() => setIsEditingSummary(v => !v)}
              disabled={!session || !session.aiSummary}
            >
              {isEditingSummary ? 'Done' : 'Edit summary'}
            </button>
          </div>
        </div>
        <div className="aiContent mt8">
          {session && (
            (session.coachQuestionsJson && session.coachQuestionsJson.length > 0) ||
            (session.coachQuestions && session.coachQuestions.length > 0) ||
            (session.coachIdeasJson && session.coachIdeasJson.length > 0) ||
            (session.coachAnswersJson && session.coachAnswersJson.length > 0)
          ) ? (
            <Card className="coachBlock">
              <h3>Coach</h3>
              {(session.coachQuestionsJson && session.coachQuestionsJson.length > 0) || (session.coachQuestions && session.coachQuestions.length > 0) ? (
                <>
                  <h4>Questions</h4>
                  <ul>
                    {session.coachQuestionsJson && session.coachQuestionsJson.length > 0
                      ? session.coachQuestionsJson.map((q, idx) => {
                          const cites = Array.isArray(q.cites) && q.cites.length > 0 ? ` [${q.cites.map(n => `L${n}`).join(',')}]` : '';
                          return <li key={idx}>{`${q.text}${cites}`}</li>;
                        })
                      : session.coachQuestions.map((q, idx) => (<li key={idx}>{q}</li>))}
                  </ul>
                </>
              ) : null}
              {session.coachIdeasJson && session.coachIdeasJson.length > 0 ? (
                <>
                  <h4>Ideas</h4>
                  <ul>
                    {session.coachIdeasJson.map((q, idx) => {
                      const cites = Array.isArray(q.cites) && q.cites.length > 0 ? ` [${q.cites.map(n => `L${n}`).join(',')}]` : '';
                      return <li key={idx}>{`${q.text}${cites}`}</li>;
                    })}
                  </ul>
                </>
              ) : null}
              {session.coachAnswersJson && session.coachAnswersJson.length > 0 ? (
                <>
                  <h4>Answers</h4>
                  <ul>
                    {session.coachAnswersJson.map((q, idx) => {
                      const cites = Array.isArray(q.cites) && q.cites.length > 0 ? ` [${q.cites.map(n => `L${n}`).join(',')}]` : '';
                      return <li key={idx}>{`${q.text}${cites}`}</li>;
                    })}
                  </ul>
                </>
              ) : null}
            </Card>
          ) : null}
          {session && (
            <Card>
              {!session.aiSummary ? (
                <div className="aiMarkdown">No summary yet.</div>
              ) : (
                isEditingSummary ? (
                  <InlineEditable
                    as="textarea"
                    value={session.aiSummary}
                    placeholder="(empty)"
                    startEditing
                    selectAllOnFocus
                    rows={20}
                    onSubmit={(next) => {
                      Meteor.call('noteSessions.update', sessionId, { aiSummary: next }, () => {
                        setIsEditingSummary(false);
                      });
                    }}
                  />
                ) : (
                  (() => {
                    const s = session.aiSummaryJson || {};
                    const toBlock = (title, arr) => {
                      if (!arr || arr.length === 0) return null;
                      return (
                        <>
                          <h3>{title}</h3>
                          <ul>
                            {arr.map((it, idx) => (
                              <li key={idx}>{`${it.text}${Array.isArray(it.cites) && it.cites.length ? ` [${it.cites.map(n => `L${n}`).join(',')}]` : ''}`}</li>
                            ))}
                          </ul>
                        </>
                      );
                    };
                    const summaryText = typeof s.summary === 'string' && s.summary.trim() ? s.summary.trim() : '';
                    const blocks = [
                      (summaryText ? (
                        <>
                          <h3>Summary</h3>
                          <p>{summaryText}</p>
                        </>
                      ) : null),
                      toBlock('Decisions', s.decisions),
                      toBlock('Risks', s.risks),
                      toBlock('Next steps', s.nextSteps)
                    ].filter(Boolean);
                    return blocks.length > 0 ? (
                      <div className="aiMarkdown">
                        {blocks.map((b, idx) => (
                          <div key={idx} style={{ marginBottom: idx < blocks.length - 1 ? 12 : 0 }}>{b}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="aiMarkdown">No summary yet.</div>
                    );
                  })()
                )
              )}
              {session.aiSummary ? (
                <div className="mt8">
                  {(() => {
                    const finalizeTooltip = !session.projectId
                      ? 'Link this session to a project to finalize as a note'
                      : (
                        `Create a project note composed of:\n` +
                        `- All current session lines (L1..Ln)\n` +
                        `- Coach questions with citations (if any)\n` +
                        `- Summary sections (Decisions, Risks, Next steps) without empty sections`
                      );
                    return (
                  <Tooltip placement="top" content={finalizeTooltip}>
                    <button
                      className="btn success"
                      disabled={isFinalizing || !session.projectId}
                      title={!session.projectId ? 'Link this session to a project to finalize as a note' : 'Finalize this recap as a project note'}
                      onClick={() => {
                      if (!session.projectId) return;
                      setIsFinalizing(true);
                      setFinalizeStatus(null);
                      const linesSection = lines.map((l, idx) => `- L${idx + 1}: ${l.content}`).join('\n');
                      let coachSection = '';
                      if (session.coachQuestionsJson && session.coachQuestionsJson.length > 0) {
                        coachSection = session.coachQuestionsJson.map(q => `- ${q.text}${Array.isArray(q.cites) && q.cites.length ? ` [${q.cites.map(n => `L${n}`).join(',')}]` : ''}`).join('\n');
                      } else if (session.coachQuestions && session.coachQuestions.length > 0) {
                        coachSection = session.coachQuestions.map(q => `- ${q}`).join('\n');
                      }
                      // Build Summary from structured JSON, skipping empty sections
                      let summaryPlain = '';
                      if (session.aiSummaryJson) {
                        const s = session.aiSummaryJson;
                        const linesOut = [];
                        const summaryText2 = typeof s.summary === 'string' && s.summary.trim() ? s.summary.trim() : '';
                        if (summaryText2) {
                          linesOut.push('Summary');
                          linesOut.push('');
                          linesOut.push(summaryText2);
                          linesOut.push('');
                        }
                        const renderArr = (title, arr) => {
                          if (!arr || arr.length === 0) return;
                          linesOut.push(title);
                          linesOut.push('');
                          linesOut.push(arr.map(it => `- ${it.text}${Array.isArray(it.cites) && it.cites.length ? ` [${it.cites.map(n => `L${n}`).join(',')}]` : ''}`).join('\n'));
                          linesOut.push('');
                        };
                        renderArr('Decisions', s.decisions);
                        renderArr('Risks', s.risks);
                        renderArr('Next steps', s.nextSteps);
                        // Trim possible trailing blank line
                        while (linesOut.length > 0 && linesOut[linesOut.length - 1] === '') linesOut.pop();
                        summaryPlain = linesOut.join('\n');
                      } else {
                        summaryPlain = mdToPlain(session.aiSummary || '');
                      }
                      const parts = [];
                      parts.push('Notes');
                      parts.push(linesSection);
                      if (coachSection) {
                        parts.push('Coach');
                        parts.push(coachSection);
                      }
                      if (summaryPlain) {
                        parts.push(summaryPlain);
                      }
                      const content = parts.join('\n\n');
                      Meteor.call('notes.insert', { projectId: session.projectId, content, kind: 'aiSummary' }, (err) => {
                        setIsFinalizing(false);
                        if (err) {
                          console.error('notes.insert failed', err);
                          setFinalizeStatus('err');
                          return;
                        }
                        setFinalizeStatus('ok');
                      });
                    }}
                    >
                      {isFinalizing ? 'Finalizing…' : 'Finalize as Note'}
                    </button>
                  </Tooltip>
                    );
                  })()}
                  {finalizeStatus === 'ok' && <span className="statusText statusSuccess">Saved</span>}
                  {finalizeStatus === 'err' && <span className="statusText statusError">Error</span>}
                </div>
              ) : null}
            </Card>
          )}
        </div>
        <div className="sessionFooter">
          <button
            className="dangerLink"
              onClick={() => {
                setShowDeleteModal(true);
              }}
              title="Delete this session"
            >
              Delete session
            </button>
          <button
            className="btn ml8"
            onClick={() => {
              const ok = window.confirm('Reset this session? This will permanently delete all session lines and clear AI coach and summary data.');
              if (!ok) return;
              Meteor.call('noteSessions.resetAll', sessionId, (err) => {
                  if (err) {
                    console.error('noteSessions.resetAll failed', err);
                  }
                });
              }}
            title="Reset all session data (lines, coach, summary)"
            >
              Reset session
            </button>
          <Modal
            open={typeof showDeleteModal === 'boolean' ? showDeleteModal : false}
            onClose={() => setShowDeleteModal(false)}
            title="Delete session"
            actions={[
              <button key="cancel" className="btn" onClick={() => setShowDeleteModal(false)}>Cancel</button>,
              <button key="del" className="btn danger" onClick={() => {
                Meteor.call('noteSessions.remove', sessionId, (err) => {
                  setShowDeleteModal(false);
                  if (err) {
                    console.error('noteSessions.remove failed', err);
                    return;
                  }
                  if (session && session.projectId) {
                    navigateTo({ name: 'project', projectId: session.projectId });
                  } else {
                    onBack();
                  }
                });
              }}>Delete</button>
            ]}
          >
            <div>This will permanently delete all note lines and AI data for this session.</div>
          </Modal>
        </div>
      </div>
    </div>
  );
};
