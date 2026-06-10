import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './CommitAnalysisModal.css';

const STATUS_FR = { added: 'ajouté', modified: 'modifié', removed: 'supprimé', renamed: 'renommé', changed: 'changé', copied: 'copié' };
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
      if (err) { setDetailErr(err.reason || 'Erreur GitHub'); setAnalyzing(false); return; }
      setDetail(res);
      Meteor.call('staffing.analyzeCommitProjects', sha, (e2, r2) => {
        if (!alive) return;
        setAnalyzing(false);
        if (e2) { setAnalyzeErr(e2.reason || 'Erreur analyse'); return; }
        setCandidates(r2?.candidates || []);
      });
    });
    return () => { alive = false; };
  }, [sha]);

  const sortedOpps = useMemo(
    () => [...opportunities].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })),
    [opportunities]
  );
  const oppName = (id) => (opportunities.find(o => o._id === id) || {}).name || '(projet supprimé)';
  const classify = (opportunityId) => { onClassify?.(sha, opportunityId); onClose?.(); };

  return (
    <Modal
      open
      onClose={onClose}
      title="Analyse approfondie du commit"
      icon="🔬"
      panelClassName="commitAnalysisPanel"
      actions={[<button key="close" type="button" className="btn" onClick={onClose}>Fermer</button>]}
    >
      <div className="caBody">
        {headline ? <div className="caHeadline" title={headline}>{headline}</div> : null}

        {!detail && !detailErr && (
          <div className="caLoading"><span className="caSpinner" aria-hidden="true" /> Récupération du commit sur GitHub…</div>
        )}
        {detailErr && <p className="caError">{detailErr}</p>}

        {detail && (
          <>
            <div className="caMeta">
              <span className="caStat caAdd">+{detail.stats.additions}</span>
              <span className="caStat caDel">−{detail.stats.deletions}</span>
              <span className="caStat">{detail.files.length} fichier{detail.files.length > 1 ? 's' : ''}</span>
              {detail.authorLogin ? <span className="caStat caAuthor">{detail.authorLogin}</span> : null}
              {detail.htmlUrl ? <a className="caGhLink" href={detail.htmlUrl} target="_blank" rel="noreferrer">GitHub ↗</a> : null}
            </div>

            <pre className="caMessage">{detail.message}</pre>

            <div className="caFilesHead">Fichiers modifiés ({detail.files.length})</div>
            <ul className="caFiles">
              {detail.files.map(f => (
                <li key={f.filename} className="caFile">
                  <span className={`caFileStatus st-${f.status}`}>{STATUS_FR[f.status] || f.status}</span>
                  <span className="caFileName" title={f.filename}>{f.filename}</span>
                  <span className="caFileNums"><span className="caAdd">+{f.additions}</span> <span className="caDel">−{f.deletions}</span></span>
                </li>
              ))}
            </ul>

            <div className="caProjects">
              <div className="caProjectsHead">Projets proposés</div>

              {analyzing && (
                <div className="caLoading"><span className="caSpinner" aria-hidden="true" /> Analyse du message et des fichiers…</div>
              )}
              {analyzeErr && <p className="caError">{analyzeErr}</p>}
              {!analyzing && candidates && candidates.length === 0 && (
                <p className="caMuted">Aucun projet existant ne correspond clairement. Choisis-en un manuellement ci-dessous.</p>
              )}
              {!analyzing && candidates && candidates.length > 0 && (
                <ul className="caCandidates">
                  {candidates.map(c => (
                    <li key={c.opportunityId} className="caCandidate">
                      <button
                        type="button"
                        className={`caCandChip ${colorClass(c.opportunityId)}`}
                        onClick={() => classify(c.opportunityId)}
                        title="Classer ce commit dans ce projet"
                      >{oppName(c.opportunityId)} <span className="caScore">{pct(c.score)}</span></button>
                      {c.reasoning ? <span className="caReason">{c.reasoning}</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              {!analyzing && (
                <div className="caManual">
                  <select defaultValue="" onChange={(e) => { if (e.target.value) classify(e.target.value); }}>
                    <option value="">+ classer dans un autre projet…</option>
                    {sortedOpps.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={() => classify('__none__')}>Aucun projet</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
