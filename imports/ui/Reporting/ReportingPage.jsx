import React, { useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import './ReportingPage.css';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { useTracker } from 'meteor/react-meteor-data';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { Notify } from '/imports/ui/components/Notify/Notify.jsx';
import { setNotifyHandler } from '/imports/ui/utils/notify.js';

const formatWhen = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString();
};

export const ReportingPage = () => {
  const [windowKey, setWindowKey] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ events: [], since: null, until: null });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiText, setAiText] = useState('');
  const [projFilters, setProjFilters] = useState(() => {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem('reporting_proj_filters');
    if (!raw) return {};
    return JSON.parse(raw) || {};
  });
  const [toast, setToast] = useState(null);
  const [aiPrompt, setAiPrompt] = useState(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('reporting_ai_prompt') || '';
  });
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const projectsById = useTracker(() => {
    const arr = ProjectsCollection.find({}, { fields: { name: 1 } }).fetch();
    const map = new Map();
    for (const p of arr) map.set(p._id, p);
    return map;
  }, [projectsReady]);

  const load = (key, filters) => {
    const k = key || windowKey;
    const effectiveFilters = (filters && typeof filters === 'object') ? filters : projFilters;
    setLoading(true);
    Meteor.call('reporting.recentActivity', k, effectiveFilters, (err, res) => {
      setLoading(false);
      if (err) { console.error('reporting.recentActivity failed', err); setData({ events: [], since: null, until: null }); return; }
      setData(res || { events: [], since: null, until: null });
    });
  };

  React.useEffect(() => { load('24h'); }, []);
  // Keep projFilters in localStorage in sync when modified via component
  React.useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reporting_proj_filters', JSON.stringify(projFilters || {}));
    }
  }, [JSON.stringify(projFilters)]);

  // Wire Notify handler to page-level toast
  React.useEffect(() => {
    setNotifyHandler((t) => setToast(t));
    return () => setNotifyHandler(null);
  }, []);

  const grouped = useMemo(() => {
    const groups = { project_created: [], task_done: [], note_created: [] };
    for (const e of (data?.events || [])) {
      if (!groups[e.type]) groups[e.type] = [];
      groups[e.type].push(e);
    }
    return groups;
  }, [JSON.stringify(data?.events || [])]);

  const titleFor = (e) => {
    const projectName = e.projectId && projectsById.get(e.projectId) ? projectsById.get(e.projectId).name : '';
    if (e.type === 'project_created') return `New project: ${e.title}`;
    if (e.type === 'task_done') return `Task done: ${e.title}${projectName ? ` — ${projectName}` : ''}`;
    if (e.type === 'note_created') return `Note added: ${e.title}${projectName ? ` — ${projectName}` : ''}`;
    return e.title || '';
  };

  return (
    <div className="reportingPage">
      <div className="reportingToolbar">
        <label htmlFor="reporting-window">Time window:</label>
        <select id="reporting-window" value={windowKey} onChange={(e) => { setWindowKey(e.target.value); load(e.target.value); }}>
          <option value="24h">Last 24h</option>
          <option value="72h">Last 72h</option>
          <option value="7d">Last 7 days</option>
        </select>
        <button className="btn ml8" onClick={() => load()}>Refresh</button>
        <span className="muted ml8">{data?.since ? `From ${formatWhen(data.since)} to ${formatWhen(data.until)}` : ''}</span>
      </div>
      <div className="reportingContent scrollArea" style={{ maxHeight: 480 }}>
        {loading ? <div className="muted">Loading…</div> : null}
        {!loading && (data?.events || []).length === 0 ? <div className="muted">No activity in this window.</div> : null}
        {['project_created', 'task_done', 'note_created'].map(section => (
          <div key={section} className="reportingSection">
            <h3>{section === 'project_created' ? 'Projects created' : section === 'task_done' ? 'Tasks completed' : 'Notes added'}</h3>
            <ul className="reportingList">
              {(grouped[section] || []).map(e => (
                <li key={`${e.type}:${e.id}`}>
                  <span className="when">{formatWhen(e.when)}</span>
                  <span className="title">{titleFor(e)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="reportingFilters">
        <h4>Projects filter</h4>
        <ProjectFilters
          projects={useTracker(() => ProjectsCollection.find({}, { fields: { name: 1, isFavorite: 1, favoriteRank: 1 } }).fetch(), [])}
          storageKey="reporting_proj_filters"
          onChange={(f) => { const next = f || {}; setProjFilters(next); load(undefined, next); }}
        />
      </div>
      <div className="reportingActions">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
          <label htmlFor="ai-prompt" style={{ minWidth: 120, marginTop: 6 }}>AI prompt (optional)</label>
          <textarea
            id="ai-prompt"
            rows={4}
            style={{ width: '100%' }}
            placeholder="Add guidance for the AI (overrides default instructions)"
            value={aiPrompt}
            onChange={(e) => {
              const v = e.target.value || '';
              setAiPrompt(v);
              if (typeof localStorage !== 'undefined') localStorage.setItem('reporting_ai_prompt', v);
            }}
          />
        </div>
        <button className="btn" disabled={aiLoading} onClick={() => {
          setAiError('');
          setAiLoading(true);
          Meteor.call('reporting.aiSummarizeWindow', windowKey, projFilters, aiPrompt, (err, res) => {
            setAiLoading(false);
            if (err) {
              console.error('AI summarize failed', err);
              setAiError(err?.reason || err?.message || 'AI summary failed');
              return;
            }
            const md = res?.markdown || '';
            if (!md.trim()) { setAiText(''); setAiError('No content to summarize'); return; }
            setAiText(md);
          });
        }}>{aiLoading ? 'Generating…' : 'Generate AI Summary'}</button>
        {aiError ? <span className="ml8" style={{ color: 'var(--danger, #f66)' }}>{aiError}</span> : null}
      </div>
      {aiText ? (
        <div className="aiSummaryActions">
          <button className="btn" onClick={() => writeClipboard(aiText)}>Copy AI Text</button>
        </div>
      ) : null}
      <div className={`aiSummary scrollArea ${aiText ? '' : 'muted'}`}>
        {aiText || 'No AI summary yet.'}
      </div>
      {toast ? (
        <Notify message={toast.message} kind={toast.kind || 'info'} onClose={() => setToast(null)} durationMs={3000} />
      ) : null}
    </div>
  );
};


