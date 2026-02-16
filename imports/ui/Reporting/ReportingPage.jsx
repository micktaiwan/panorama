import React, { useState } from 'react';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import { Collapsible } from '/imports/ui/components/Collapsible/Collapsible.jsx';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import { useReportingData } from '/imports/ui/hooks/useReportingData.js';
import './ReportingPage.css';

const SECTIONS = [
  { key: 'task_done', label: 'Tasks completed', color: 'var(--success)' },
  { key: 'project_created', label: 'Projects created', color: 'var(--primary)' },
  { key: 'note_created', label: 'Notes added', color: 'var(--info)' },
];

const STAT_CARDS = [
  { key: 'tasksCompleted', label: 'Tasks completed', color: 'var(--success)' },
  { key: 'projectsCreated', label: 'Projects created', color: 'var(--primary)' },
  { key: 'notesAdded', label: 'Notes added', color: 'var(--info)' },
];

export const ReportingPage = () => {
  const [projFilters, setProjFilters] = useState(() => {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem('reporting_proj_filters')) || {};
    } catch { return {}; }
  });

  const rp = useReportingData({ projectFilters: projFilters });

  const handleFiltersChange = (filters) => {
    const next = filters || {};
    setProjFilters(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('reporting_proj_filters', JSON.stringify(next));
    }
    rp.load(undefined, next);
  };

  const handleWindowChange = (e) => {
    const k = e.target.value;
    rp.setWindowKey(k);
    rp.load(k);
  };

  const eventHref = (ev) => {
    if (ev.type === 'note_created') return `#/notes/${ev.id}`;
    if (ev.projectId) return `#/projects/${ev.projectId}`;
    return null;
  };

  const titleFor = (ev) => {
    const proj = ev.projectId ? rp.projectsById.get(ev.projectId) : null;
    // Don't repeat project name for project_created — the title IS the project name
    const showProject = ev.type !== 'project_created';
    return { title: ev.title || '', projectName: showProject ? (proj?.name || '') : '', projectHref: ev.projectId ? `#/projects/${ev.projectId}` : null };
  };

  const nonEmptySections = SECTIONS.filter(s => (rp.grouped[s.key] || []).length > 0);

  return (
    <div className="rp-page">
      <div className="rp-accent" />

      {/* Header */}
      <div className="rp-header">
        <h1 className="rp-title">Reporting</h1>
        <div className="rp-toolbar">
          <select className="rp-select" value={rp.windowKey} onChange={handleWindowChange}>
            <option value="24h">Last 24h</option>
            <option value="72h">Last 72h</option>
            <option value="7d">Last 7 days</option>
            <option value="3w">Last 3 weeks</option>
            <option value="all">All time</option>
          </select>
          <button className="btn" onClick={() => rp.load()}>Refresh</button>
          {rp.data?.since && (
            <span className="rp-dateRange">
              {rp.formatWhen(rp.data.since)} — {rp.formatWhen(rp.data.until)}
            </span>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="rp-statsRow">
        {STAT_CARDS.map(sc => (
          <div key={sc.key} className="rp-statCard" style={{ '--stat-color': sc.color }}>
            <span className="rp-statNumber">{rp.stats[sc.key]}</span>
            <span className="rp-statLabel">{sc.label}</span>
          </div>
        ))}
      </div>

      {/* Project filters */}
      <div className="rp-filters">
        <ProjectFilters
          projects={rp.allProjects}
          storageKey="reporting_proj_filters"
          onChange={handleFiltersChange}
        />
      </div>

      {/* Body: activity + sidebar */}
      <div className="rp-body">
        {/* Activity column */}
        <div className="rp-activity">
          {rp.loading && <div className="muted" style={{ padding: 12 }}>Loading…</div>}

          {!rp.loading && nonEmptySections.length === 0 && (
            <div className="rp-empty">No activity in this window.</div>
          )}

          {nonEmptySections.map(section => (
            <Collapsible key={section.key} title={section.label} defaultOpen className="rp-section">
              <ul className="rp-eventList">
                {(rp.grouped[section.key] || []).map(ev => {
                  const { title, projectName, projectHref } = titleFor(ev);
                  const href = eventHref(ev);
                  return (
                    <li key={`${ev.type}:${ev.id}`} className="rp-eventItem">
                      <span className="rp-eventDot" style={{ '--dot-color': section.color }} />
                      <div className="rp-eventContent">
                        {href
                          ? <a className="rp-eventTitle rp-link" href={href}>{title}</a>
                          : <span className="rp-eventTitle">{title}</span>
                        }
                        {projectName && (
                          projectHref
                            ? <a className="rp-eventProject rp-link" href={projectHref}>{projectName}</a>
                            : <span className="rp-eventProject">{projectName}</span>
                        )}
                      </div>
                      <span className="rp-eventTime">{rp.formatWhen(ev.when)}</span>
                    </li>
                  );
                })}
              </ul>
            </Collapsible>
          ))}
        </div>

        {/* AI Sidebar */}
        <div className="rp-sidebar">
          <Card
            title="AI Summary"
            actions={
              <button
                className="btn"
                disabled={rp.aiLoading}
                onClick={() => rp.generateAiSummary(projFilters)}
              >
                {rp.aiLoading ? 'Generating…' : 'Generate'}
              </button>
            }
          >
            {/* AI output */}
            <div className={`rp-aiOutput scrollArea${rp.aiText ? '' : ' muted'}`}>
              {rp.aiText || 'No AI summary yet.'}
            </div>

            {rp.aiText && (
              <div className="rp-aiActions">
                <button className="btn" onClick={() => writeClipboard(rp.aiText)}>Copy</button>
              </div>
            )}

            {rp.aiError && (
              <div className="rp-aiError">{rp.aiError}</div>
            )}

            {/* Config collapsed */}
            <Collapsible title="Configuration" defaultOpen={false}>
              <div className="rp-aiConfig">
                <div className="rp-aiConfigRow">
                  <label htmlFor="rp-ai-lang">Language</label>
                  <select id="rp-ai-lang" value={rp.aiLang} onChange={e => rp.setAiLang(e.target.value)}>
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div className="rp-aiConfigRow">
                  <label htmlFor="rp-ai-format">Format</label>
                  <select id="rp-ai-format" value={rp.aiFormat} onChange={e => rp.setAiFormat(e.target.value)}>
                    <option value="text">Text</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </div>
                {(rp.recentPrompts || []).length > 0 && (
                  <div className="rp-aiConfigRow">
                    <label htmlFor="rp-ai-recent">Recent</label>
                    <select
                      id="rp-ai-recent"
                      value=""
                      onChange={e => {
                        if (e.target.value) rp.setAiPrompt(e.target.value);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Select…</option>
                      {(rp.recentPrompts || []).map((p, i) => (
                        <option key={`rp-${i}`} value={p}>
                          {p.length > 50 ? p.slice(0, 47) + '…' : p}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="rp-aiConfigRow rp-aiConfigRow--full">
                  <label htmlFor="rp-ai-prompt">Custom prompt</label>
                  <textarea
                    id="rp-ai-prompt"
                    rows={3}
                    placeholder="Override default AI instructions…"
                    value={rp.aiPrompt}
                    onChange={e => rp.setAiPrompt(e.target.value)}
                  />
                </div>
              </div>
            </Collapsible>
          </Card>
        </div>
      </div>
    </div>
  );
};
