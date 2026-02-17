import { useMemo, useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProjectsCollection } from '/imports/api/projects/collections';

const formatWhen = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString();
};

const lsGet = (key, fallback) => {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const _lsSet = (key, value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

/**
 * Shared hook for reporting data — used by ReportingPage and ActivitySummary.
 * Manages time window, data loading, AI summary, project lookup, localStorage persistence.
 */
export const useReportingData = ({
  initialWindowKey = '24h',
  projectFilters = {},
} = {}) => {
  const [windowKey, setWindowKey] = useState(initialWindowKey);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ events: [], since: null, until: null });

  // AI state
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
    const arr = lsGet('reporting_ai_recent_prompts', []);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
  });

  // Projects lookup
  const projectsReady = useTracker(() => Meteor.subscribe('projects').ready(), []);
  const projectsById = useTracker(() => {
    const arr = ProjectsCollection.find({}, { fields: { name: 1 } }).fetch();
    const map = new Map();
    for (const p of arr) map.set(p._id, p);
    return map;
  }, [projectsReady]);
  const allProjects = useTracker(
    () => ProjectsCollection.find({}, { fields: { name: 1, isFavorite: 1, favoriteRank: 1 } }).fetch(),
    [projectsReady]
  );

  // Load data
  const load = useCallback((key, filters) => {
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
  }, [windowKey, projectFilters]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reporting_ai_recent_prompts', JSON.stringify(recentPrompts || []));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(recentPrompts)]);

  const upsertRecentPrompt = useCallback((prompt) => {
    const v = String(prompt || '').trim();
    if (!v) return;
    setRecentPrompts(prev => {
      const exists = (prev || []).some(p => p === v);
      if (exists) return prev;
      const next = [v, ...(prev || [])];
      if (next.length > 10) next.pop();
      return next;
    });
  }, []);

  // Group events by type
  const grouped = useMemo(() => {
    const groups = { project_created: [], task_done: [], note_created: [] };
    for (const e of (data?.events || [])) {
      if (!groups[e.type]) groups[e.type] = [];
      groups[e.type].push(e);
    }
    return groups;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data?.events || [])]);

  // Stats
  const stats = useMemo(() => ({
    tasksCompleted: (grouped.task_done || []).length,
    projectsCreated: (grouped.project_created || []).length,
    notesAdded: (grouped.note_created || []).length,
  }), [grouped]);

  // Generate AI summary
  const generateAiSummary = useCallback((filters) => {
    setAiError('');
    setAiLoading(true);
    const opts = { lang: aiLang || 'fr', format: aiFormat || 'text' };
    const effectiveFilters = (filters && typeof filters === 'object') ? filters : projectFilters;
    Meteor.call('reporting.aiSummarizeWindow', windowKey, effectiveFilters, aiPrompt, opts, (err, res) => {
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
      if (String(aiPrompt || '').trim()) upsertRecentPrompt(aiPrompt);
    });
  }, [windowKey, projectFilters, aiPrompt, aiLang, aiFormat, upsertRecentPrompt]);

  return {
    // Time window
    windowKey, setWindowKey,
    // Data
    loading, data, load,
    // Grouped
    grouped, stats,
    // Projects
    projectsById, allProjects,
    // AI
    aiLoading, aiError, aiText,
    aiLang, setAiLang,
    aiFormat, setAiFormat,
    aiPrompt, setAiPrompt,
    recentPrompts, upsertRecentPrompt,
    generateAiSummary,
    setAiText,
    // Helpers
    formatWhen,
  };
};
