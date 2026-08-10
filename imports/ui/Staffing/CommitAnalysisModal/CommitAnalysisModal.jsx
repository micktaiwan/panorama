import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import './CommitAnalysisModal.css';

const STATUS_LABELS = { added: 'added', modified: 'modified', removed: 'removed', renamed: 'renamed', changed: 'changed', copied: 'copied' };
const colorClass = (id) => {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `chip-c${h % 8}`;
};
const pct = (s) => `${Math.round((s || 0) * 100)}%`;

/**
 * On-demand deep analysis of one unclassified commit.
 * Phase 1: fetch the full commit (message + files + stats) and display it.
 * Phase 2 (auto): rank it against existing projects and propose classifications.
 * Mount with a `key={sha}` so each commit gets a fresh lifecycle.
 */
export const CommitAnalysisModal = ({ sha, headline, opportunities = [], onClassify, onClose }) => {
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState(null);
  const [candidates, setCandidates] = useState(null); // null while loading, [] when none
  const [analyzeErr, setAnalyzeErr] = useState(null);
  const [analyzing, setAnalyzing] = useState(true);

  useEffect(() => {
    let alive = true;
    setDetail(null); setDetailErr(null); setCandidates(null); setAnalyzeErr(null); setAnalyzing(true);
    Meteor.call('staffing.fetchCommitDetail', sha, (err, res) => {
      if (!alive) return;
      if (err) { setDetailErr(err.reason || 'GitHub error'); setAnalyzing(false); return; }
      setDetail(res);
      Meteor.call('staffing.analyzeCommitProjects', sha, (e2, r2) => {
        if (!alive) return;
        setAnalyzing(false);
        if (e2) { setAnalyzeErr(e2.reason || 'Analysis error'); return; }
        setCandidates(r2?.candidates || []);
      });
    });
    return () => { alive = false; };
  }, [sha]);

  const sortedOpps = useMemo(
    () => [...opportunities].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })),
    [opportunities]
  );
  const oppName = (id) => (opportunities.find(o => o._id === id) || {}).name || '(deleted project)';
  const classify = (opportunityId) => { onClassify?.(sha, opportunityId); onClose?.(); };

  return (
    <Modal
      open
      onClose={onClose}
      title="Deep commit analysis"
      icon="🔬"
      panelClassName="commitAnalysisPanel"
      actions={[<button key="close" type="button" className="btn" onClick={onClose}>Close</button>]}
    >
      <div className="caBody">
        {headline ? (
          <div className="caHeadline">
            <Tooltip content={headline} size="large" className="tooltipTriggerBlock">{headline}</Tooltip>
          </div>
        ) : null}

        {!detail && !detailErr && (
          <div className="caLoading"><span className="caSpinner" aria-hidden="true" /> Fetching the commit from GitHub…</div>
        )}
        {detailErr && <p className="caError">{detailErr}</p>}

        {detail && (
          <>
            <div className="caMeta">
              <span className="caStat caAdd">+{detail.stats.additions}</span>
              <span className="caStat caDel">−{detail.stats.deletions}</span>
              <span className="caStat">{detail.files.length} file{detail.files.length > 1 ? 's' : ''}</span>
              {detail.authorLogin ? <span className="caStat caAuthor">{detail.authorLogin}</span> : null}
              {detail.htmlUrl ? <a className="caGhLink" href={detail.htmlUrl} target="_blank" rel="noreferrer">GitHub ↗</a> : null}
            </div>

            <pre className="caMessage">{detail.message}</pre>

            <div className="caFilesHead">Changed files ({detail.files.length})</div>
            <ul className="caFiles">
              {detail.files.map(f => (
                <li key={f.filename} className="caFile">
                  <span className={`caFileStatus st-${f.status}`}>{STATUS_LABELS[f.status] || f.status}</span>
                  <Tooltip content={f.filename} className="caFileNameTip">
                    <span className="caFileName">{f.filename}</span>
                  </Tooltip>
                  <span className="caFileNums"><span className="caAdd">+{f.additions}</span> <span className="caDel">−{f.deletions}</span></span>
                </li>
              ))}
            </ul>

            <div className="caProjects">
              <div className="caProjectsHead">Suggested projects</div>

              {analyzing && (
                <div className="caLoading"><span className="caSpinner" aria-hidden="true" /> Analyzing the message and the files…</div>
              )}
              {analyzeErr && <p className="caError">{analyzeErr}</p>}
              {!analyzing && candidates && candidates.length === 0 && (
                <p className="caMuted">No existing project clearly matches. Pick one manually below.</p>
              )}
              {!analyzing && candidates && candidates.length > 0 && (
                <ul className="caCandidates">
                  {candidates.map(c => (
                    <li key={c.opportunityId} className="caCandidate">
                      <Tooltip content="Classify this commit into this project">
                        <button
                          type="button"
                          className={`caCandChip ${colorClass(c.opportunityId)}`}
                          onClick={() => classify(c.opportunityId)}
                        >{oppName(c.opportunityId)} <span className="caScore">{pct(c.score)}</span></button>
                      </Tooltip>
                      {c.reasoning ? <span className="caReason">{c.reasoning}</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              {!analyzing && (
                <div className="caManual">
                  <select defaultValue="" onChange={(e) => { if (e.target.value) classify(e.target.value); }}>
                    <option value="">+ classify into another project…</option>
                    {sortedOpps.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={() => classify('__none__')}>No project</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
