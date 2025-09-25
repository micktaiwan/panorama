import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import './UserLog.css';
import { useTracker } from 'meteor/react-meteor-data';
import { UserLogsCollection } from '/imports/api/userLogs/collections';
import { timeAgo } from '/imports/ui/utils/date.js';
import { notify } from '/imports/ui/utils/notify.js';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { InlineTasksHeader } from './components/InlineTasksHeader.jsx';
import { InlineTasksList } from './components/InlineTasksList.jsx';
import { formatHms, hourKey, formatHourLabel } from './utils';
import { HourHeader } from './components/HourHeader/HourHeader.jsx';
import { EntryRow } from './components/EntryRow/EntryRow.jsx';

export default function UserLog() {
  // formatting helpers imported from './utils'
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Visible range for entries list: default last 24h; load more adds one day
  const [visibleDays, setVisibleDays] = useState(1);
  const sinceDate = useMemo(() => new Date(Date.now() - (visibleDays * 24 * 3600 * 1000)), [visibleDays]);
  // Subscribe, but do not gate rendering on readiness to avoid empty flicker/scroll jumps
  useTracker(() => { Meteor.subscribe('userLogs.since', sinceDate); return null; }, [sinceDate]);
  const entries = useTracker(
    () => UserLogsCollection.find({ createdAt: { $gte: sinceDate } }, { sort: { createdAt: -1 } }).fetch(),
    [sinceDate]
  );

  // Track first entry id to keep memo deps simple and avoid deep comparisons
  const entriesFirstId = entries?.[0]?._id || '';

  // Summarize and modal state (declared early so effects can reference them safely)
  const [cleaningIds, setCleaningIds] = useState(() => ({}));
  const [summarizing, setSummarizing] = useState(false);
  const [summaryModal, setSummaryModal] = useState(null);
  const [summaryWindow, setSummaryWindow] = useState(3);
  const [summaryPrompt, setSummaryPrompt] = useState('');
  const [hasSavedSummary, setHasSavedSummary] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return !!localStorage.getItem('userlog_last_summary_v1');
  });
  const [hideExisting, setHideExisting] = useState(() => {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem('userlog_hide_existing_v1');
    if (raw === '0') return false;
    if (raw === '1') return true;
    return true;
  });

  const windowInfo = useMemo(() => {
    const now = new Date();
    const since = new Date(now.getTime() - Number(summaryWindow || 0) * 3600000);
    const sameDay = since.getFullYear() === now.getFullYear() && since.getMonth() === now.getMonth() && since.getDate() === now.getDate();
    const y = new Date(now); y.setDate(now.getDate() - 1); y.setHours(0,0,0,0);
    const sinceDay = new Date(since); sinceDay.setHours(0,0,0,0);
    const isYesterday = sinceDay.getTime() === y.getTime();
    let dayPrefix = '';
    if (!sameDay) {
      dayPrefix = isYesterday ? 'Yesterday ' : `${since.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} `;
    }
    const label = `${dayPrefix}${formatHms(since)}`;
    const cutoff = since.getTime();
    const count = Array.isArray(entries) ? entries.filter(e => (new Date(e.createdAt).getTime() >= cutoff)).length : 0;
    return { label, count };
  }, [summaryWindow, entriesFirstId]);

  // Focus input on page mount
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);
  // Persist hideExisting toggle
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('userlog_hide_existing_v1', hideExisting ? '1' : '0');
  }, [hideExisting]);

  // Removed local ⌘J toggle and overlay close: handled globally as navigation

  // Build a Set of log ids that already have a DB task linked (moved up to avoid TDZ in callbacks)
  const tasksReady = useTracker(() => Meteor.subscribe('tasks.userLogLinks').ready(), []);
  const { linkedLogIdSet, logIdToTask } = useTracker(() => {
    const set = new Set();
    const map = new Map();
    if (!tasksReady) return { linkedLogIdSet: set, logIdToTask: map };
    const tasks = TasksCollection.find(
      { 'source.kind': 'userLog' },
      { fields: { 'source.logEntryIds': 1, projectId: 1 } }
    ).fetch();
    for (const t of (tasks || [])) {
      const ids = Array.isArray(t?.source?.logEntryIds) ? t.source.logEntryIds : [];
      for (const id of ids) {
        const key = String(id);
        set.add(key);
        if (!map.has(key)) map.set(key, { taskId: t._id, projectId: t.projectId });
      }
    }
    
    return { linkedLogIdSet: set, logIdToTask: map };
  }, [tasksReady]);

  const isLinkedSuggestion = useCallback((task) => {
    if (!task) return false;
    const ids = Array.isArray(task?.sourceLogIds) ? task.sourceLogIds : [];
    for (const id of ids) {
      if (linkedLogIdSet.has(String(id))) return true;
    }
    return false;
  }, [linkedLogIdSet]);

  const visibleSummaryTasks = useMemo(() => {
    const all = Array.isArray(summaryModal?.tasks) ? summaryModal.tasks : [];
    if (!hideExisting) return all;
    return all.filter(t => !isLinkedSuggestion(t));
  }, [summaryModal, hideExisting, isLinkedSuggestion]);

  const hiddenTasksCount = useMemo(() => {
    const all = Array.isArray(summaryModal?.tasks) ? summaryModal.tasks : [];
    if (!hideExisting) return 0;
    return Math.max(0, all.length - visibleSummaryTasks.length);
  }, [summaryModal, hideExisting, visibleSummaryTasks]);

  const creatableCount = useMemo(() => {
    const all = Array.isArray(summaryModal?.tasks) ? summaryModal.tasks : [];
    return all.filter(t => !isLinkedSuggestion(t)).length;
  }, [summaryModal, isLinkedSuggestion]);

  const copySummary = useCallback(() => {
    const text = summaryModal?.summary || '';
    import('/imports/ui/utils/clipboard.js').then(m => m.writeClipboard(text));
  }, [summaryModal]);

  const createAll = useCallback(async () => {
    const all = Array.isArray(summaryModal?.tasks) ? summaryModal.tasks : [];
    const windowHours = summaryModal?.windowHours;
    if (all.length === 0) { notify({ message: 'No tasks to create', kind: 'info' }); return; }
    const queue = all.filter(t => !isLinkedSuggestion(t));
    if (queue.length === 0) { notify({ message: 'No new tasks to create', kind: 'info' }); return; }
    const skipped = all.length - queue.length;
    let created = 0; let failed = 0;

    const callInsert = (fields) => new Promise((resolve) => {
      Meteor.call('tasks.insert', fields, (err) => {
        if (err) failed += 1; else created += 1;
        resolve();
      });
    });

    for (const t of queue) {
      const fields = { title: t.title, notes: t.notes || '', projectId: t.projectId || null };
      if (t.deadline) fields.deadline = t.deadline;
      if (Array.isArray(t?.sourceLogIds) && t.sourceLogIds.length > 0) {
        fields.source = { kind: 'userLog', logEntryIds: t.sourceLogIds, windowHours };
      }
      // eslint-disable-next-line no-await-in-loop
      await callInsert(fields);
    }
    const parts = [`Created ${created}`];
    if (skipped > 0) parts.push(`skipped ${skipped}`);
    if (failed > 0) parts.push(`${failed} failed`);
    notify({ message: parts.join(' · '), kind: failed ? 'warning' : 'success' });
  }, [summaryModal, isLinkedSuggestion]);

  const handleSummarize = useCallback(() => {
    setSummarizing(true);
    const opt = { promptOverride: String(summaryPrompt || '').trim() };
    Meteor.call('userLogs.summarizeWindow', 'userlog', summaryWindow, opt, (err, res) => {
      setSummarizing(false);
      if (err) {
        console.error('userLogs.summarizeWindow failed', err);
        notify({ message: 'Summarize failed', kind: 'error' });
        return;
      }
      const summary = (typeof res?.summary === 'string') ? res.summary : '';
      const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
      
      const norm = tasks.map(t => ({ title: t.title || '', notes: t.notes || '', projectId: t.projectId || '', deadline: t.deadline || '', sourceLogIds: Array.isArray(t?.sourceLogIds) ? t.sourceLogIds : [] }));
      const usedCustomPrompt = !!opt.promptOverride;
      const payload = { summary, tasks: norm, windowHours: summaryWindow, customPrompt: usedCustomPrompt };
      setSummaryModal(payload);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('userlog_last_summary_v1', JSON.stringify(payload));
          setHasSavedSummary(true);
        } catch (error) {
          console.error('Failed to persist last summary in localStorage', error);
          notify({ message: 'Failed to save summary locally', kind: 'warning' });
        }
      }
    });
  }, [summaryPrompt, summaryWindow]);

  const handleReopenSummary = useCallback(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('userlog_last_summary_v1');
      if (!raw) { notify({ message: 'No saved summary', kind: 'error' }); return; }
      const parsed = JSON.parse(raw);
      setSummaryModal(parsed && typeof parsed === 'object' ? parsed : null);
    } catch (error) {
      console.error('Failed to load saved summary', error);
      notify({ message: 'Failed to load saved summary', kind: 'error' });
    }
  }, []);

  // Pressing Enter in the custom prompt input triggers summarization
  const onPromptKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSummarize();
    }
  }, [handleSummarize]);

  // InlineSummary row helpers
  const updateTaskDeadline = useCallback((rowTask, next) => {
    setSummaryModal(prev => {
      if (!prev) return prev;
      const index = prev.tasks.indexOf(rowTask);
      if (index === -1) return prev;
      const nextTasks = prev.tasks.slice();
      nextTasks[index] = { ...nextTasks[index], deadline: next || '' };
      return { ...prev, tasks: nextTasks };
    });
  }, []);

  const updateTaskProjectId = useCallback((rowTask, value) => {
    setSummaryModal(prev => {
      if (!prev) return prev;
      const index = prev.tasks.indexOf(rowTask);
      if (index === -1) return prev;
      const nextTasks = prev.tasks.slice();
      nextTasks[index] = { ...nextTasks[index], projectId: value };
      return { ...prev, tasks: nextTasks };
    });
  }, []);

  const createSingleTask = useCallback((task, windowHours) => {
    const fields = { title: task.title, notes: task.notes || '', projectId: task.projectId || null };
    if (task.deadline) fields.deadline = task.deadline;
    if (Array.isArray(task?.sourceLogIds) && task.sourceLogIds.length > 0) {
      fields.source = { kind: 'userLog', logEntryIds: task.sourceLogIds, windowHours };
    }
    Meteor.call('tasks.insert', fields, (err) => {
      if (err) {
        console.error('tasks.insert failed', err);
        notify({ message: 'Create task failed', kind: 'error' });
        return;
      }
      notify({ message: 'Task created', kind: 'success' });
    });
  }, []);

  const handleClean = useCallback((entry) => {
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
  }, []);

  const handleUpdateContent = useCallback((entry, content) => {
    Meteor.call('userLogs.update', entry._id, { content }, (err) => {
      if (err) {
        console.error('userLogs.update failed', err);
        notify({ message: 'userLogs.update failed', kind: 'error' });
      }
    });
  }, []);

  const handleOpenLinkedProject = useCallback((entry) => {
    const info = logIdToTask.get(String(entry._id));
    if (info?.projectId) {
      const id = String(info.projectId);
      const hl = `userlog:${entry._id}`;
      window.location.hash = `#/projects/${id}?hl=${encodeURIComponent(hl)}`;
    }
  }, [logIdToTask]);

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
  }, [handleSubmit]);

 

  // Projects for task assignment
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const projects = useTracker(() => {
    if (!projectsReady) return [];
    const fetched = ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetch();
    return fetched.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [projectsReady]);
  // Note: we only need project names to populate the select options below; no separate map needed.
  const handleLoadMore = useCallback(() => { setVisibleDays(d => (Number(d) || 1) + 1); }, []);

  return (
    <div className="UserLog__page" aria-live="polite">
        <div className="UserLog__header">
          <div className="UserLog__title">Journal</div>
        </div>
          {summaryModal ? (
            <div className="UserLog__inlineSummary" aria-label="UserLog Summary">
              <div className="UserLog__inlineSummaryHeader">
                <div className="UserLog__inlineSummaryTitle">Summary — last {summaryModal.windowHours}h</div>
                <div className="UserLog__inlineSummaryActions">
                  <button className="btn" onClick={copySummary}>Copy summary</button>
                  <button className="UserLog__close ml8" onClick={() => setSummaryModal(null)} aria-label="Close">×</button>
                </div>
              </div>
              <div className={`UserLog__inlineSummaryBody${summaryModal?.customPrompt ? ' isFull' : ''}`}>
                <div className="UserLog__inlineSummaryText scrollArea">{summaryModal.summary || '(empty)'}</div>
                {summaryModal?.customPrompt ? null : (
                  <div className="UserLog__inlineTasks">
                    <InlineTasksHeader
                      hideExisting={hideExisting}
                      onToggleHideExisting={setHideExisting}
                      onCreateAll={createAll}
                      creatableCount={creatableCount}
                    />
                    <InlineTasksList
                      tasks={visibleSummaryTasks}
                      projects={projects}
                      linkedLogIdSet={linkedLogIdSet}
                      isLinkedSuggestion={isLinkedSuggestion}
                      hiddenTasksCount={hiddenTasksCount}
                      hideExisting={hideExisting}
                      onUpdateDeadline={updateTaskDeadline}
                      onUpdateProject={updateTaskProjectId}
                      onCreateSingle={(t, h) => createSingleTask(t, h)}
                      windowHours={summaryModal.windowHours}
                    />
                  </div>
                )}
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
                onKeyDown={onPromptKeyDown}
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
              onClick={handleSummarize}
            >{summarizing ? 'Summarizing…' : 'Summarize'}</button>
            <button
              className="btn ml8"
              disabled={!hasSavedSummary || summarizing}
              onClick={handleReopenSummary}
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
                      onClean={handleClean}
                      onUpdateContent={handleUpdateContent}
                      formatHms={formatHms}
                      timeAgo={timeAgo}
                      isLinked={linkedLogIdSet.has(String(e._id))}
                      onOpenLinkedProject={handleOpenLinkedProject}
                    />
                  </React.Fragment>
                );
              })
            ) : (
              <div className="UserLog__empty">No entries yet. Type and press Enter to add.</div>
            )}
          </div>
          <div className="UserLog__loadMore">
            <button type="button" className="btn" onClick={handleLoadMore}>Load more (older 1 day)</button>
            <span className="ml8 muted">since {timeAgo(sinceDate)}</span>
          </div>
    </div>
  );
}


