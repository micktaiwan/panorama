import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import './UserLog.css';
import { useTracker } from 'meteor/react-meteor-data';
import { UserLogsCollection } from '/imports/api/userLogs/collections';
import { timeAgo } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import { formatHms, hourKey, formatHourLabel } from './utils';
import { HourHeader } from './components/HourHeader/HourHeader.jsx';
import { EntryRow } from './components/EntryRow/EntryRow.jsx';

export default function UserLog() {
  // formatting helpers imported from './utils'
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('userlog_open') === '1';
  });
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const ready = useTracker(() => Meteor.subscribe('userLogs.recent', 300).ready(), []);
  const entries = useTracker(
    () => (ready ? UserLogsCollection.find({}, { sort: { createdAt: -1 } }).fetch() : []),
    [ready]
  );

  // Summarize and modal state (declared early so effects can reference them safely)
  const [cleaningIds, setCleaningIds] = useState(() => ({}));
  const [summarizing, setSummarizing] = useState(false);
  const [summaryModal, setSummaryModal] = useState(null); // { summary, tasks, windowHours }
  const [summaryWindow, setSummaryWindow] = useState(3);
  const [summaryPrompt, setSummaryPrompt] = useState('');
  const [hasSavedSummary, setHasSavedSummary] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return !!localStorage.getItem('userlog_last_summary_v1');
  });

  const windowInfo = useMemo(() => {
    const now = new Date();
    const since = new Date(now.getTime() - Number(summaryWindow || 0) * 3600000);
    const sameDay = since.getFullYear() === now.getFullYear() && since.getMonth() === now.getMonth() && since.getDate() === now.getDate();
    const y = new Date(now); y.setDate(now.getDate() - 1); y.setHours(0,0,0,0);
    const sinceDay = new Date(since); sinceDay.setHours(0,0,0,0);
    const isYesterday = sinceDay.getTime() === y.getTime();
    const dayPrefix = sameDay ? '' : (isYesterday ? 'Yesterday ' : `${since.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} `);
    const label = `${dayPrefix}${formatHms(since)}`;
    const cutoff = since.getTime();
    const count = Array.isArray(entries) ? entries.filter(e => (new Date(e.createdAt).getTime() >= cutoff)).length : 0;
    return { label, count };
  }, [summaryWindow, entries && entries.length > 0 ? entries[0] && entries[0]._id : '']);

  // Persist open state
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('userlog_open', isOpen ? '1' : '0');
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  const toggleOpen = useCallback(() => setIsOpen(v => !v), []);

  // Global shortcut: ⌘J toggles overlay and focuses new line
  useEffect(() => {
    const onKey = (e) => {
      const key = String(e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'j') {
        e.preventDefault();
        setIsOpen(prev => {
          const next = !prev;
          if (next) {
            setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
          }
          return next;
        });
      }
      if (e.key === 'Escape') {
        // Close summary first if open
        if (summaryModal) {
          e.preventDefault();
          setSummaryModal(null);
          return;
        }
        const target = e.target;
        const tag = (target && target.tagName ? String(target.tagName).toLowerCase() : '');
        const isEditable = (target && target.isContentEditable) || tag === 'input' || tag === 'textarea' || tag === 'select';
        if (isEditable) return;
        if (isOpen) {
          e.preventDefault();
          setIsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, summaryModal]);

  const handleSubmit = useCallback(() => {
    const trimmed = String(input || '').trim();
    if (!trimmed) return;
    Meteor.call('userLogs.insert', { content: trimmed }, (err) => {
      if (err) {
        console.error('userLogs.insert failed', err);
        return;
      }
      setInput('');
      if (listRef.current) listRef.current.scrollTop = 0;
    });
  }, [input]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  }, [handleSubmit]);

 

  // Projects for task assignment
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const projects = useTracker(() => (projectsReady ? ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetch() : []), [projectsReady]);
  // Note: we only need project names to populate the select options below; no separate map needed.

  // Build a Set of log ids that already have a DB task linked
  const tasksReady = useTracker(() => Meteor.subscribe('tasks.userLogLinks').ready(), []);
  const { linkedLogIdSet, logIdToTask } = useTracker(() => {
    const set = new Set();
    const map = new Map();
    if (!tasksReady) return { linkedLogIdSet: set, logIdToTask: map };
    const tasks = TasksCollection.find({ 'source.kind': 'userLog' }, { fields: { 'source.logEntryIds': 1, projectId: 1 } }).fetch();
    for (const t of (tasks || [])) {
      const ids = t && t.source && Array.isArray(t.source.logEntryIds) ? t.source.logEntryIds : [];
      for (const id of ids) {
        const key = String(id);
        set.add(key);
        if (!map.has(key)) map.set(key, { taskId: t._id, projectId: t.projectId });
      }
    }
    return { linkedLogIdSet: set, logIdToTask: map };
  }, [tasksReady]);

  return (
    <div className={`UserLog__root${isOpen ? ' isOpen' : ''}`} aria-live="polite">
      <button type="button" className="UserLog__fab" onClick={toggleOpen} aria-haspopup="dialog" aria-expanded={isOpen} title={isOpen ? 'Close journal' : 'Open journal'}>
        📝
      </button>
      {isOpen && (
        <div className="UserLog__panel" role="dialog" aria-label="User Log">
          <div className="UserLog__header">
            <div className="UserLog__title">Journal</div>
            <button className="UserLog__close" onClick={() => setIsOpen(false)} aria-label="Close">×</button>
          </div>
          {summaryModal ? (
            <div className="UserLog__inlineSummary" aria-label="UserLog Summary">
              <div className="UserLog__inlineSummaryHeader">
                <div className="UserLog__inlineSummaryTitle">Summary — last {summaryModal.windowHours}h</div>
                <button className="UserLog__close" onClick={() => setSummaryModal(null)} aria-label="Close">×</button>
              </div>
              <div className="UserLog__inlineSummaryActions">
                <button className="btn" onClick={() => {
                  const text = summaryModal.summary || '';
                  import('/imports/ui/utils/clipboard.js').then(m => m.writeClipboard(text));
                }}>Copy summary</button>
                <button className="btn ml8" onClick={() => {
                  const all = Array.isArray(summaryModal.tasks) ? summaryModal.tasks : [];
                  if (all.length === 0) return;
                  const queue = all.filter(t => !(Array.isArray(t.sourceLogIds) && t.sourceLogIds.some(id => linkedLogIdSet.has(String(id)))));
                  if (queue.length === 0) { notify({ message: 'No new tasks to create', kind: 'info' }); return; }
                  const skipped = all.length - queue.length;
                  let created = 0; let failed = 0;
                  const next = () => {
                    const t = queue.shift();
                    if (!t) {
                      const parts = [`Created ${created}`];
                      if (skipped > 0) parts.push(`skipped ${skipped}`);
                      if (failed > 0) parts.push(`${failed} failed`);
                      notify({ message: parts.join(' · '), kind: failed ? 'warning' : 'success' });
                      return;
                    }
                    const fields = { title: t.title, notes: t.notes || '', projectId: t.projectId || null };
                    if (t.deadline) fields.deadline = t.deadline;
                    if (Array.isArray(t.sourceLogIds) && t.sourceLogIds.length > 0) {
                      fields.source = { kind: 'userLog', logEntryIds: t.sourceLogIds, windowHours: summaryModal.windowHours };
                    }
                    Meteor.call('tasks.insert', fields, (err) => {
                      if (err) { failed += 1; } else { created += 1; }
                      next();
                    });
                  };
                  next();
                }}>Create all</button>
              </div>
              <div className="UserLog__inlineSummaryBody">
                <div className="UserLog__inlineSummaryText scrollArea">{summaryModal.summary || '(empty)'}</div>
                <div className="UserLog__inlineTasks">
                  <div className="UserLog__inlineTasksTitle">Task suggestions</div>
                  {summaryModal.tasks && summaryModal.tasks.length > 0 ? (
                    <ul className="UserLog__inlineTasksList scrollArea">
                      {summaryModal.tasks.map((t, idx) => {
                        const stableKey = (t && Array.isArray(t.sourceLogIds) && t.sourceLogIds.length > 0)
                          ? `src:${t.sourceLogIds.join(',')}`
                          : (t && t.title ? `title:${t.title}` : `idx:${idx}`);
                        const hasDbLinked = Array.isArray(t.sourceLogIds) && t.sourceLogIds.some(id => linkedLogIdSet.has(String(id)));
                        return (
                        <li key={stableKey} className={`UserLog__inlineTaskRow${hasDbLinked ? ' isLinked' : ''}`}>
                          <div className="UserLog__inlineTaskMain">
                            <div className="UserLog__inlineTaskTitle">{t.title}</div>
                            {t.notes ? <div className="UserLog__inlineTaskNotes">{t.notes}</div> : null}
                            <div className="UserLog__inlineTaskDeadline">
                              <label>Deadline:&nbsp;</label>
                              <InlineDate
                                value={t.deadline || ''}
                                onSubmit={(next) => {
                                  setSummaryModal(prev => {
                                    if (!prev) return prev;
                                    const nextTasks = prev.tasks.slice();
                                    nextTasks[idx] = { ...nextTasks[idx], deadline: next || '' };
                                    return { ...prev, tasks: nextTasks };
                                  });
                                }}
                                placeholder="No deadline"
                              />
                            </div>
                            <div className="UserLog__inlineTaskProject">
                              <label htmlFor={`ul_task_project_${idx}`}>Project:&nbsp;</label>
                              <select
                                className="UserLog__inlineTaskProjectSelect"
                                id={`ul_task_project_${idx}`}
                                value={t.projectId || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSummaryModal(prev => {
                                    if (!prev) return prev;
                                    const nextTasks = prev.tasks.slice();
                                    nextTasks[idx] = { ...nextTasks[idx], projectId: val };
                                    return { ...prev, tasks: nextTasks };
                                  });
                                }}
                              >
                                <option value="">(none)</option>
                                {(projects || []).map(p => (
                                  <option key={p._id} value={p._id}>{p.name || '(untitled)'}</option>
                                ))}
                              </select>
                            </div>
                            {hasDbLinked ? (
                              <div className="muted" title="Task already exists for these journal entries">Task already exists</div>
                            ) : null}
                          </div>
                          <button
                            className="btn btn-xs"
                            disabled={hasDbLinked}
                            onClick={() => {
                              const fields = { title: t.title, notes: t.notes || '', projectId: t.projectId || null };
                              if (t.deadline) fields.deadline = t.deadline;
                              if (Array.isArray(t.sourceLogIds) && t.sourceLogIds.length > 0) {
                                fields.source = { kind: 'userLog', logEntryIds: t.sourceLogIds, windowHours: summaryModal.windowHours };
                              }
                              Meteor.call('tasks.insert', fields, (err) => {
                                if (err) {
                                  console.error('tasks.insert failed', err);
                                  notify({ message: 'Create task failed', kind: 'error' });
                                  return;
                                }
                                notify({ message: 'Task created', kind: 'success' });
                              });
                            }}
                          >Create task</button>
                        </li>
                      );})}
                    </ul>
                  ) : (
                    <div className="UserLog__empty">No suggested tasks.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <div className="UserLog__toolbar">
            <label htmlFor="ul_window">Window:</label>
            <select
              id="ul_window"
              value={summaryWindow}
              onChange={(e) => setSummaryWindow(Number(e.target.value))}
              className="UserLog__windowSelect"
            >
              <option value={1}>Last 1h</option>
              <option value={3}>Last 3h</option>
              <option value={24}>Last 24h</option>
              <option value={24*7}>Last 7 days</option>
            </select>
            <span className="UserLog__windowInfo muted">⇒ {windowInfo.label} · {windowInfo.count} lines</span>
            <div className="UserLog__promptInputWrap ml8">
              <input
                id="ul_prompt"
                type="text"
                className="UserLog__promptInput"
                placeholder="Custom prompt (optional)"
                value={summaryPrompt}
                onChange={(e) => setSummaryPrompt(e.target.value)}
              />
              {summaryPrompt ? (
                <button
                  type="button"
                  className="UserLog__promptClear"
                  aria-label="Clear prompt"
                  title="Clear"
                  onClick={() => {
                    setSummaryPrompt('');
                    setTimeout(() => {
                      const el = document.getElementById('ul_prompt');
                      if (el) el.focus();
                    }, 0);
                  }}
                >×</button>
              ) : null}
            </div>
            <button
              className="btn ml8"
              disabled={summarizing}
              onClick={() => {
                setSummarizing(true);
                const opt = { promptOverride: String(summaryPrompt || '').trim() };
                Meteor.call('userLogs.summarizeWindow', 'userlog', summaryWindow, opt, (err, res) => {
                  setSummarizing(false);
                  if (err) {
                    console.error('userLogs.summarizeWindow failed', err);
                    notify({ message: 'Summarize failed', kind: 'error' });
                    return;
                  }
                  const summary = (res && typeof res.summary === 'string') ? res.summary : '';
                  const tasks = Array.isArray(res && res.tasks) ? res.tasks : [];
                  // Normalize local tasks state with editable projectId
                  const norm = tasks.map(t => ({ title: t.title || '', notes: t.notes || '', projectId: t.projectId || '', deadline: t.deadline || '', sourceLogIds: Array.isArray(t && t.sourceLogIds) ? t.sourceLogIds : [] }));
                  const payload = { summary, tasks: norm, windowHours: summaryWindow };
                  setSummaryModal(payload);
                  if (typeof localStorage !== 'undefined') {
                    try {
                      localStorage.setItem('userlog_last_summary_v1', JSON.stringify(payload));
                      setHasSavedSummary(true);
                    } catch (e) {
                      console.warn('Failed to persist last summary in localStorage', e);
                    }
                  }
                });
              }}
            >{summarizing ? 'Summarizing…' : 'Summarize'}</button>
            <button
              className="btn ml8"
              disabled={!hasSavedSummary || summarizing}
              onClick={() => {
                if (typeof localStorage === 'undefined') return;
                try {
                  const raw = localStorage.getItem('userlog_last_summary_v1');
                  if (!raw) { notify({ message: 'No saved summary', kind: 'error' }); return; }
                  const parsed = JSON.parse(raw);
                  setSummaryModal(parsed && typeof parsed === 'object' ? parsed : null);
                } catch (_e) {
                  notify({ message: 'Failed to load saved summary', kind: 'error' });
                }
              }}
            >Reopen summary</button>
          </div>
          <div className="UserLog__composer UserLog__composer--top">
            <input
              type="text"
              className="UserLog__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type your note… Press Enter to save"
              ref={inputRef}
            />
          </div>

          <div className="UserLog__list scrollArea" ref={listRef}>
            {Array.isArray(entries) && entries.length > 0 ? (
              entries.map((e, idx) => {
                const curKey = hourKey(e.createdAt);
                const prevKey = idx > 0 ? hourKey(entries[idx - 1].createdAt) : null;
                const showHeader = curKey !== prevKey;
                return (
                  <React.Fragment key={e._id}>
                    {showHeader ? (
                      <HourHeader label={formatHourLabel(e.createdAt)} />
                    ) : null}
                    <EntryRow
                      entry={e}
                      isCleaning={!!cleaningIds[e._id]}
                      onClean={(entry) => {
                        setCleaningIds(prev => ({ ...prev, [entry._id]: true }));
                        Meteor.call('ai.cleanUserLog', entry._id, (err) => {
                          setCleaningIds(prev => ({ ...prev, [entry._id]: false }));
                          if (err) {
                            console.error('ai.cleanUserLog failed', err);
                            notify({ message: 'Correction échouée', kind: 'error' });
                            return;
                          }
                          notify({ message: 'Entrée corrigée', kind: 'success' });
                        });
                      }}
                      onUpdateContent={(entry, content) => {
                        Meteor.call('userLogs.update', entry._id, { content }, (err) => {
                          if (err) {
                            console.error('userLogs.update failed', err);
                            notify({ message: 'userLogs.update failed', kind: 'error' });
                            return;
                          }
                        });
                      }}
                      formatHms={formatHms}
                      timeAgo={timeAgo}
                      isLinked={linkedLogIdSet.has(String(e._id))}
                      onOpenLinkedProject={(entry) => {
                        const info = logIdToTask.get(String(entry._id));
                        if (info && info.projectId) {
                          setIsOpen(false);
                          const id = String(info.projectId);
                          const hl = `userlog:${entry._id}`;
                          window.location.hash = `#/projects/${id}?hl=${encodeURIComponent(hl)}`;
                        }
                      }}
                    />
                  </React.Fragment>
                );
              })
            ) : (
              <div className="UserLog__empty">No entries yet. Type and press Enter to add.</div>
            )}
          </div>
          
        </div>
      )}
      
    </div>
  );
}


