import React, { useMemo, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import './ActivitySummary.css';

const formatWhen = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString();
};

export const ActivitySummary = ({ 
  projectFilters = {}, 
  windowKey: initialWindowKey = '24h', 
  showProjectFilter = true,
  title = 'Activity Summary',
  onFiltersChange,
  className = ''
}) => {
  const [windowKey, setWindowKey] = useState(initialWindowKey);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ events: [], since: null, until: null });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiText, setAiText] = useState('');
  const [aiLang, setAiLang] = useState(() => {
    if (typeof localStorage === 'undefined') return 'fr';
    return localStorage.getItem('reporting_ai_lang') || 'fr';
  });
  const [aiFormat, setAiFormat] = useState(() => {
    if (typeof localStorage === 'undefined') return 'text';
    return localStorage.getItem('reporting_ai_format') || 'text';
  });
  const [aiPrompt, setAiPrompt] = useState(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('reporting_ai_prompt') || '';
  });
  const [recentPrompts, setRecentPrompts] = useState(() => {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem('reporting_ai_recent_prompts');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
    } catch (e) {
      console.error('Failed to parse reporting_ai_recent_prompts', e);
      return [];
    }
  });

  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const projectsById = useTracker(() => {
    const arr = ProjectsCollection.find({}, { fields: { name: 1 } }).fetch();
    const map = new Map();
    for (const p of arr) map.set(p._id, p);
    return map;
  }, [projectsReady]);
  
  const allProjects = useTracker(() => ProjectsCollection.find({}, { fields: { name: 1, isFavorite: 1, favoriteRank: 1 } }).fetch(), [projectsReady]);

  const load = (key, filters) => {
    const k = key || windowKey;
    const effectiveFilters = (filters && typeof filters === 'object') ? filters : projectFilters;
    setLoading(true);
    Meteor.call('reporting.recentActivity', k, effectiveFilters, (err, res) => {
      setLoading(false);
      if (err) { 
        console.error('reporting.recentActivity failed', err); 
        setData({ events: [], since: null, until: null }); 
        return; 
      }
      setData(res || { events: [], since: null, until: null });
    });
  };

  useEffect(() => { load(windowKey); }, []);
  
  // Persist AI options
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('reporting_ai_lang', aiLang || 'fr');
  }, [aiLang]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('reporting_ai_format', aiFormat || 'text');
  }, [aiFormat]);
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('reporting_ai_prompt', aiPrompt || '');
  }, [aiPrompt]);
  // Persist recent prompts
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reporting_ai_recent_prompts', JSON.stringify(recentPrompts || []));
    }
  }, [JSON.stringify(recentPrompts)]);

  const upsertRecentPrompt = (prompt) => {
    const v = String(prompt || '').trim();
    if (!v) return; // do not save default/empty
    setRecentPrompts(prev => {
      const exists = (prev || []).some(p => p === v);
      if (exists) return prev;
      const next = [v, ...(prev || [])];
      if (next.length > 10) next.pop();
      return next;
    });
  };

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
    const projectSuffix = projectName ? ` — ${projectName}` : '';
    
    if (e.type === 'project_created') return `New project: ${e.title}`;
    if (e.type === 'task_done') return `Task done: ${e.title}${projectSuffix}`;
    if (e.type === 'note_created') return `Note added: ${e.title}${projectSuffix}`;
    return e.title || '';
  };

  const handleFiltersChange = (filters) => {
    if (onFiltersChange) {
      onFiltersChange(filters);
    }
    load(undefined, filters);
  };

  return (
    <div className={`activitySummary ${className}`}>
      <div className="activitySummaryToolbar">
        <label htmlFor="activity-window">Time window:</label>
        <select 
          id="activity-window" 
          value={windowKey} 
          onChange={(e) => { 
            const newWindowKey = e.target.value;
            setWindowKey(newWindowKey);
            load(newWindowKey); 
          }}
        >
          <option value="24h">Last 24h</option>
          <option value="72h">Last 72h</option>
          <option value="7d">Last 7 days</option>
          <option value="3w">Last 3 weeks</option>
          <option value="all">All time</option>
        </select>
        <button className="btn ml8" onClick={() => load()}>Refresh</button>
        <span className="muted ml8">
          {data?.since ? `From ${formatWhen(data.since)} to ${formatWhen(data.until)}` : ''}
        </span>
      </div>

      <div className="activitySummaryContent scrollArea" style={{ maxHeight: 480 }}>
        {loading ? <div className="muted">Loading…</div> : null}
        {!loading && (data?.events || []).length === 0 ? (
          <div className="muted">No activity in this window.</div>
        ) : null}
        {['project_created', 'task_done', 'note_created'].map(section => (
          <div key={section} className="activitySummarySection">
            <h3>
              {(() => {
                if (section === 'project_created') return 'Projects created';
                if (section === 'task_done') return 'Tasks completed';
                return 'Notes added';
              })()}
            </h3>
            <ul className="activitySummaryList">
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

      {showProjectFilter && (
        <div className="activitySummaryFilters">
          <h4>Projects filter</h4>
          <ProjectFilters
            projects={allProjects}
            storageKey="activity_summary_proj_filters"
            onChange={handleFiltersChange}
          />
        </div>
      )}

      <div className="activitySummaryActions">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor="ai-recent" style={{ minWidth: 120 }}>Recent prompts</label>
          <select 
            id="ai-recent" 
            value="" 
            onChange={(e) => {
              const sel = e.target.value || '';
              if (!sel) return;
              setAiPrompt(sel);
              if (typeof localStorage !== 'undefined') localStorage.setItem('reporting_ai_prompt', sel);
              e.target.value = '';
            }}
          >
            <option value="">Select…</option>
            {(recentPrompts || []).map((p, index) => (
              <option key={`rp-${p}-${index}`} value={p}>
                {p.length > 60 ? p.slice(0, 57) + '…' : p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor="ai-lang" style={{ minWidth: 120 }}>Langue</label>
          <select id="ai-lang" value={aiLang} onChange={(e) => setAiLang(e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <label htmlFor="ai-format" style={{ minWidth: 120 }}>Format</label>
          <select id="ai-format" value={aiFormat} onChange={(e) => setAiFormat(e.target.value)}>
            <option value="text">Texte</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>
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
        <button 
          className="btn" 
          disabled={aiLoading} 
          onClick={() => {
            setAiError('');
            setAiLoading(true);
            const opts = { lang: aiLang || 'fr', format: aiFormat || 'text' };
            Meteor.call('reporting.aiSummarizeWindow', windowKey, projectFilters, aiPrompt, opts, (err, res) => {
              setAiLoading(false);
              if (err) {
                console.error('AI summarize failed', err);
                setAiError(err?.reason || err?.message || 'AI summary failed');
                return;
              }
              const content = (aiFormat === 'markdown' ? (res?.markdown || res?.text || '') : (res?.text || res?.markdown || ''));
              if (!String(content || '').trim()) { 
                setAiText(''); 
                setAiError('No content to summarize'); 
                return; 
              }
              setAiText(content);
              // Save prompt if non-empty and not default
              if (String(aiPrompt || '').trim()) upsertRecentPrompt(aiPrompt);
            });
          }}
        >
          {aiLoading ? 'Generating…' : 'Generate AI Summary'}
        </button>
        {aiError ? (
          <span className="ml8" style={{ color: 'var(--danger, #f66)' }}>{aiError}</span>
        ) : null}
      </div>

      {aiText ? (
        <div className="aiSummaryActions">
          <button className="btn" onClick={() => writeClipboard(aiText)}>Copy AI Text</button>
        </div>
      ) : null}

      <div className={`aiSummary scrollArea ${aiText ? '' : 'muted'}`}>
        {aiText || 'No AI summary yet.'}
      </div>
    </div>
  );
};

ActivitySummary.propTypes = {
  projectFilters: PropTypes.object,
  windowKey: PropTypes.string,
  showProjectFilter: PropTypes.bool,
  title: PropTypes.string,
  onFiltersChange: PropTypes.func,
  className: PropTypes.string,
};
