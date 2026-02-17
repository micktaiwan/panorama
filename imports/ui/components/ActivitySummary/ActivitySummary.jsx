import React from 'react';
import PropTypes from 'prop-types';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import { useReportingData } from '/imports/ui/hooks/useReportingData.js';
import './ActivitySummary.css';

export const ActivitySummary = ({
  projectFilters = {},
  windowKey: initialWindowKey = '24h',
  showProjectFilter = true,
  title: _title = 'Activity Summary',
  onFiltersChange,
  className = '',
  excludeTypes = []
}) => {
  const rp = useReportingData({ initialWindowKey, projectFilters });

  const titleFor = (e) => {
    const proj = e.projectId ? rp.projectsById.get(e.projectId) : null;
    const projectSuffix = proj?.name ? ` — ${proj.name}` : '';

    if (e.type === 'project_created') return `New project: ${e.title}${e.createdBy ? ` (by ${e.createdBy})` : ''}`;
    if (e.type === 'task_done') return `Task done: ${e.title}${projectSuffix}`;
    if (e.type === 'note_created') return `Note added: ${e.title}${projectSuffix}`;
    return e.title || '';
  };

  const handleFiltersChange = (filters) => {
    if (onFiltersChange) onFiltersChange(filters);
    rp.load(undefined, filters);
  };

  return (
    <div className={`activitySummary ${className}`}>
      <div className="activitySummaryToolbar">
        <label htmlFor="activity-window">Time window:</label>
        <select
          id="activity-window"
          value={rp.windowKey}
          onChange={(e) => {
            const k = e.target.value;
            rp.setWindowKey(k);
            rp.load(k);
          }}
        >
          <option value="24h">Last 24h</option>
          <option value="72h">Last 72h</option>
          <option value="7d">Last 7 days</option>
          <option value="3w">Last 3 weeks</option>
          <option value="all">All time</option>
        </select>
        <button className="btn ml8" onClick={() => rp.load()}>Refresh</button>
        <span className="muted ml8">
          {rp.data?.since ? `From ${rp.formatWhen(rp.data.since)} to ${rp.formatWhen(rp.data.until)}` : ''}
        </span>
      </div>

      <div className="activitySummaryContent scrollArea" style={{ maxHeight: 480 }}>
        {rp.loading ? <div className="muted">Loading…</div> : null}
        {!rp.loading && (rp.data?.events || []).length === 0 ? (
          <div className="muted">No activity in this window.</div>
        ) : null}
        {['project_created', 'task_done', 'note_created'].filter(s => !excludeTypes.includes(s)).map(section => (
          <div key={section} className="activitySummarySection">
            <h3>
              {section === 'project_created' ? 'Projects created' : section === 'task_done' ? 'Tasks completed' : 'Notes added'}
            </h3>
            <ul className="activitySummaryList">
              {(rp.grouped[section] || []).map(e => (
                <li key={`${e.type}:${e.id}`}>
                  <span className="when">{rp.formatWhen(e.when)}</span>
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
            projects={rp.allProjects}
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
              if (e.target.value) rp.setAiPrompt(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Select…</option>
            {(rp.recentPrompts || []).map((p, index) => (
              <option key={`rp-${p}-${index}`} value={p}>
                {p.length > 60 ? p.slice(0, 57) + '…' : p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor="ai-lang" style={{ minWidth: 120 }}>Langue</label>
          <select id="ai-lang" value={rp.aiLang} onChange={(e) => rp.setAiLang(e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <label htmlFor="ai-format" style={{ minWidth: 120 }}>Format</label>
          <select id="ai-format" value={rp.aiFormat} onChange={(e) => rp.setAiFormat(e.target.value)}>
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
            value={rp.aiPrompt}
            onChange={(e) => rp.setAiPrompt(e.target.value)}
          />
        </div>
        <button
          className="btn"
          disabled={rp.aiLoading}
          onClick={() => rp.generateAiSummary(projectFilters)}
        >
          {rp.aiLoading ? 'Generating…' : 'Generate AI Summary'}
        </button>
        {rp.aiError ? (
          <span className="ml8" style={{ color: 'var(--danger, #f66)' }}>{rp.aiError}</span>
        ) : null}
      </div>

      {rp.aiText ? (
        <div className="aiSummaryActions">
          <button className="btn" onClick={() => writeClipboard(rp.aiText)}>Copy AI Text</button>
        </div>
      ) : null}

      <div className={`aiSummary scrollArea ${rp.aiText ? '' : 'muted'}`}>
        {rp.aiText || 'No AI summary yet.'}
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
  excludeTypes: PropTypes.arrayOf(PropTypes.string),
};
