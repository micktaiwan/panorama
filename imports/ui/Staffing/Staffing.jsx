import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { PeopleCollection } from '/imports/api/people/collections';
import { TeamsCollection } from '/imports/api/teams/collections';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { CommitsCollection } from '/imports/api/staffing/gitCollections';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import { navigateTo } from '/imports/ui/router.js';
import './Staffing.css';

const FR_DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const personLabel = (p) => `${p?.name || ''}${p?.lastName ? ' ' + p.lastName : ''}`.trim();

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const buildDays = (n) => {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push({ key: dayKey(d), label: `${FR_DAYS[d.getDay()]} ${d.getDate()}` });
  }
  return out;
};
const colorClass = (id) => {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `chip-c${h % 8}`;
};
const shortName = (name) => {
  const n = String(name || '').trim();
  return n.length > 16 ? n.slice(0, 15) + '…' : n;
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const PHASE_FR = {
  fetching: 'Récupération des commits…',
  ranking: 'Classement LLM (lecture du texte)',
  staffing: 'Écriture du staffing…'
};
const progressLabel = (p) => {
  if (!p) return 'Analyse en cours…';
  let s = PHASE_FR[p.phase] || 'Analyse…';
  if (p.phase === 'ranking' && p.total) s += ` lot ${p.current}/${p.total}`;
  if (p.startedAt) s += ` · ${Math.round((Date.now() - p.startedAt) / 1000)}s`;
  return s;
};

const WINDOW_DAYS = 7;
const REVIEW_PAGE_SIZE = 10;

export const Staffing = () => {
  const loadingPeople = useSubscribe('people.all');
  const loadingTeams = useSubscribe('teams.all');
  const loadingOpps = useSubscribe('opportunities.all');
  useSubscribe('commits.recent', 1000);
  useSubscribe('userPreferences');

  const people = useFind(() => PeopleCollection.find({}, { sort: { normalizedName: 1 } }));
  const teams = useFind(() => TeamsCollection.find({}, { sort: { name: 1 } }));
  const opportunities = useFind(() => OpportunitiesCollection.find({}, { sort: { order: 1, createdAt: 1 } }));
  const commits = useFind(() => CommitsCollection.find({}, { sort: { committedAt: -1 } }));
  const userPrefs = useTracker(() => UserPreferencesCollection.findOne({}) || null, []);

  const [teamId, setTeamId] = useState('');
  const [showGit, setShowGit] = useState(false);
  const [ghRepo, setGhRepo] = useState('');
  const [ghToken, setGhToken] = useState('');
  const [ghWindow, setGhWindow] = useState('');
  const [ghInit, setGhInit] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [reviewPage, setReviewPage] = useState(0);
  const [newProjFor, setNewProjFor] = useState({}); // sha -> draft name
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (userPrefs && !ghInit) {
      const gh = userPrefs.github || {};
      setGhRepo(gh.repo || '');
      setGhWindow(typeof gh.windowDays === 'number' ? String(gh.windowDays) : '14');
      setGhInit(true);
    }
  }, [userPrefs, ghInit]);
  const hasToken = !!(userPrefs?.github?.token);

  const loading = loadingPeople() || loadingTeams() || loadingOpps();

  const peopleById = useMemo(() => {
    const m = new Map();
    people.forEach(p => m.set(p._id, p));
    return m;
  }, [people]);

  const teamsById = useMemo(() => {
    const m = new Map();
    teams.forEach(t => m.set(t._id, t.name));
    return m;
  }, [teams]);

  const oppById = useMemo(() => {
    const m = new Map();
    opportunities.forEach(o => m.set(o._id, o.name));
    return m;
  }, [opportunities]);

  // Resolve a commit author to a person: githubUsername (login) > email.
  const resolver = useMemo(() => {
    const byLogin = new Map();
    const byEmail = new Map();
    people.forEach(p => {
      if (p.githubUsername) byLogin.set(p.githubUsername.toLowerCase(), p._id);
      if (p.email) byEmail.set(p.email.toLowerCase(), p._id);
    });
    return (c) => {
      if (c.authorLogin && byLogin.has(c.authorLogin.toLowerCase())) return byLogin.get(c.authorLogin.toLowerCase());
      if (c.authorEmail && byEmail.has(c.authorEmail.toLowerCase())) return byEmail.get(c.authorEmail.toLowerCase());
      return null;
    };
  }, [people]);

  const days = useMemo(() => buildDays(WINDOW_DAYS), []);

  // Timeline grid: a cell chip exists only for commits the user has CLASSIFIED
  // (commit.opportunityId). Unclassified commits keep the person active but show no chip.
  const { grid, activeIds, unresolved } = useMemo(() => {
    const windowKeys = new Set(days.map(d => d.key));
    const g = new Map();          // personId -> Map(dayKey -> Map(oppId -> chip))
    const active = new Set();
    const unres = new Map();       // login -> count
    commits.forEach(c => {
      if (!c.committedAt) return;
      const k = dayKey(c.committedAt);
      if (!windowKeys.has(k)) return;
      const pid = resolver(c);
      if (!pid) { if (c.authorLogin) unres.set(c.authorLogin, (unres.get(c.authorLogin) || 0) + 1); return; }
      active.add(pid);
      if (!c.opportunityId) return; // unclassified → no chip yet
      if (!g.has(pid)) g.set(pid, new Map());
      const dm = g.get(pid);
      if (!dm.has(k)) dm.set(k, new Map());
      const cell = dm.get(k);
      if (!cell.has(c.opportunityId)) cell.set(c.opportunityId, { label: oppById.get(c.opportunityId) || '(projet supprimé)', oppId: c.opportunityId });
    });
    return { grid: g, activeIds: active, unresolved: unres };
  }, [commits, resolver, oppById, days]);

  // Review queue: unclassified, not-dismissed commits, most recent first, paginated.
  const reviewCommits = useMemo(
    () => commits.filter(c => !c.opportunityId && !c.noProject),
    [commits]
  );
  const classifiedCount = useMemo(() => commits.filter(c => c.opportunityId).length, [commits]);
  const pageCount = Math.max(1, Math.ceil(reviewCommits.length / REVIEW_PAGE_SIZE));
  const safePage = Math.min(reviewPage, pageCount - 1);
  const pageCommits = reviewCommits.slice(safePage * REVIEW_PAGE_SIZE, safePage * REVIEW_PAGE_SIZE + REVIEW_PAGE_SIZE);

  // Rows: active people, optional team filter, grouped by team name.
  const groups = useMemo(() => {
    const rows = [...activeIds]
      .map(id => peopleById.get(id))
      .filter(Boolean)
      .filter(p => !teamId || p.teamId === teamId);
    const byTeam = new Map();
    rows.forEach(p => {
      const key = p.teamId || '__none__';
      if (!byTeam.has(key)) byTeam.set(key, []);
      byTeam.get(key).push(p);
    });
    const arr = [...byTeam.entries()].map(([key, members]) => ({
      key,
      label: key === '__none__' ? 'Sans équipe' : (teamsById.get(key) || 'Équipe'),
      members: members.sort((a, b) => personLabel(a).localeCompare(personLabel(b)))
    }));
    arr.sort((a, b) => a.label.localeCompare(b.label));
    return arr;
  }, [activeIds, peopleById, teamId, teamsById]);

  const saveGithubConfig = () => {
    const github = { repo: ghRepo.trim(), windowDays: Number(ghWindow) || 14 };
    if (ghToken.trim()) github.token = ghToken.trim();
    Meteor.call('userPreferences.update', { github }, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      setGhToken('');
      notify({ message: 'Config GitHub enregistrée', kind: 'success' });
    });
  };

  const runAnalysis = () => {
    setRunning(true);
    setProgress({ phase: 'fetching', startedAt: Date.now() });
    const poll = setInterval(() => {
      Meteor.call('staffing.githubAnalysisProgress', (e, prog) => { if (!e && prog) setProgress(prog); });
    }, 1500);
    Meteor.call('staffing.runGithubAnalysis', (err, res) => {
      clearInterval(poll);
      setRunning(false);
      setProgress(null);
      if (err) { notify({ message: err.reason || 'Erreur analyse Git', kind: 'error' }); return; }
      setLastResult(res);
      notify({ message: `Analyse OK : ${res.commitsIngested} commits, ${res.ranked} avec candidats`, kind: 'success' });
    });
  };

  const rerankUnclassified = () => {
    if (running) return;
    setRunning(true);
    setProgress({ phase: 'ranking', startedAt: Date.now() });
    const poll = setInterval(() => {
      Meteor.call('staffing.githubAnalysisProgress', (e, prog) => { if (!e && prog) setProgress(prog); });
    }, 1500);
    Meteor.call('staffing.rerankUnclassified', (err, res) => {
      clearInterval(poll);
      setRunning(false);
      setProgress(null);
      if (err) { notify({ message: err.reason || 'Erreur recalcul', kind: 'error' }); return; }
      notify({ message: `Propositions recalculées (${res.ranked}/${res.total})`, kind: 'success' });
    });
  };

  const setGithubUsername = (personId, githubUsername) => {
    Meteor.call('people.update', personId, { githubUsername }, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      notify({ message: `Rattaché : ${githubUsername}`, kind: 'success' });
    });
  };

  const classifyCommit = (sha, opportunityId) => Meteor.call('staffing.setCommitOpportunity', sha, opportunityId, (err) => {
    if (err) notify({ message: err.reason || 'Erreur', kind: 'error' });
  });
  const createAndAssign = (sha, name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    Meteor.call('opportunities.insert', { name: trimmed }, (err, newId) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      classifyCommit(sha, newId);
      setNewProjFor(prev => { const n = { ...prev }; delete n[sha]; return n; });
      notify({ message: `Projet « ${trimmed} » créé et rattaché`, kind: 'success' });
      // New project should now be proposed for the remaining unclassified commits.
      rerankUnclassified();
    });
  };

  const wipeData = () => {
    setWiping(true);
    Meteor.call('staffing.wipeData', (err, res) => {
      setWiping(false);
      setConfirmWipe(false);
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      notify({ message: `Données effacées : ${res.commits} commits, ${res.opportunities} projets`, kind: 'success' });
    });
  };

  if (loading) {
    return <div className="staffing"><p className="muted">Loading…</p></div>;
  }

  const managablePeople = people.filter(p => !p.left).sort((a, b) => personLabel(a).localeCompare(personLabel(b)));

  return (
    <div className="staffing">
      <div className="staffingHeader">
        <div className="staffingTitle">
          <h2>Staffing — qui bosse sur quoi</h2>
          <span className="staffingHint">Activité Git, {WINDOW_DAYS} derniers jours · 1 colonne = 1 jour, chips = projets classés</span>
        </div>
        <div className="staffingTools">
          <button type="button" className={`gitToggle ${showGit ? 'active' : ''}`} onClick={() => setShowGit(v => !v)}>⎇ Git</button>
          <label className="staffingField">
            Équipe
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Toutes</option>
              {teams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn btnDanger" onClick={() => setConfirmWipe(true)}>🗑 Delete Data</button>
        </div>
      </div>

      <div className="staffingAlerts">
        <span className="alertChip">{activeIds.size} devs actifs ({WINDOW_DAYS}j)</span>
        <span className="alertChip">{commits.length} commits ingérés</span>
        <span className="alertChip">{classifiedCount} classés</span>
        {reviewCommits.length > 0 && <span className="alertChip warn">{reviewCommits.length} à classer</span>}
        {unresolved.size > 0 && <span className="alertChip danger">{unresolved.size} auteurs non rattachés</span>}
      </div>

      {showGit && (
        <div className="gitPanel">
          <div className="gitConfig">
            <label className="staffingField">
              Repo (owner/name)
              <input type="text" placeholder="l3mpire/lempire" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} />
            </label>
            <label className="staffingField">
              Token PAT (optionnel) {hasToken ? <span className="okBadge">enregistré</span> : null}
              <input type="password" placeholder={hasToken ? '•••••• (laisser vide)' : 'sinon GitHub App serveur'} value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
            </label>
            <label className="staffingField">
              Fenêtre d'analyse (jours)
              <input type="number" min="1" max="90" value={ghWindow} onChange={(e) => setGhWindow(e.target.value)} />
            </label>
            <button type="button" className="btn" onClick={saveGithubConfig}>Enregistrer</button>
            <button type="button" className="btn btnPrimary" onClick={runAnalysis} disabled={running || !ghRepo.trim()}>
              {running ? 'Analyse en cours…' : '⎇ Analyser le Git'}
            </button>
          </div>
          {running && <div className="gitProgress">⏳ {progressLabel(progress)}</div>}
          {lastResult && (
            <div className="gitResult">
              {lastResult.commitsIngested} commits · <strong>{lastResult.ranked}</strong> avec candidats · {lastResult.opportunities} projets existants
              {lastResult.unresolvedAuthors?.length > 0 && <span className="gitWarn"> · {lastResult.unresolvedAuthors.length} auteurs non résolus</span>}
            </div>
          )}

          {unresolved.size > 0 && (
            <div className="gitSuggestions">
              <div className="gitSuggestionsTitle">Auteurs Git non rattachés — assigne un github login à une personne</div>
              {[...unresolved.entries()].sort((a, b) => b[1] - a[1]).map(([login, n]) => (
                <div key={login} className="unresolvedRow">
                  <span className="unresolvedLogin">{login} <span className="suggestionConf">{n} commits</span></span>
                  <select defaultValue="" onChange={(e) => { if (e.target.value) setGithubUsername(e.target.value, login); }}>
                    <option value="">→ rattacher à…</option>
                    {managablePeople.map(p => <option key={p._id} value={p._id}>{personLabel(p)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Review queue (test scaffolding): classify commits 10 at a time ---- */}
      {reviewCommits.length > 0 && (
        <div className="reviewPanel">
          <div className="reviewHead">
            <div className="reviewTitle">
              À classer — {reviewCommits.length} commits (revue manuelle)
              {running && <span className="reviewReranking"> · ⏳ {progressLabel(progress)}</span>}
            </div>
            <div className="reviewPager">
              <button type="button" className="btn" disabled={running || opportunities.length === 0} onClick={rerankUnclassified} title="Recalcule le top-5 des commits non classés avec les projets et mots-clés actuels">↻ Recalculer</button>
              <button type="button" className="btn" disabled={safePage <= 0} onClick={() => setReviewPage(p => Math.max(0, p - 1))}>← Préc.</button>
              <span className="reviewPageInfo">Page {safePage + 1} / {pageCount}</span>
              <button type="button" className="btn" disabled={safePage >= pageCount - 1} onClick={() => setReviewPage(p => Math.min(pageCount - 1, p + 1))}>Suiv. →</button>
            </div>
          </div>
          {opportunities.length === 0 && (
            <p className="muted">Aucun projet existant — crée des projets via « Nouveau projet… » ci-dessous pour pouvoir classer.</p>
          )}
          <div className="reviewList">
            {pageCommits.map(c => {
              const pid = resolver(c);
              const cands = (c.candidates || []).filter(x => oppById.has(x.opportunityId));
              const draft = newProjFor[c.sha];
              return (
                <div key={c.sha} className="reviewRow">
                  <div className="reviewMeta">
                    <span className="reviewDate">{fmtDateTime(c.committedAt)}</span>
                    <span className="reviewAuthor">{pid ? personLabel(peopleById.get(pid)) : (c.authorLogin || c.authorEmail || '—')}</span>
                  </div>
                  <div className="reviewMsg" title={c.message}>{c.message}</div>
                  <div className="reviewCandidates">
                    {cands.length === 0 && <span className="reviewNoCand">aucun candidat proposé</span>}
                    {cands.map(x => (
                      <button
                        key={x.opportunityId}
                        type="button"
                        className={`candChip ${colorClass(x.opportunityId)}`}
                        title={`${oppById.get(x.opportunityId)} — score ${(x.score * 100).toFixed(0)}%`}
                        onClick={() => classifyCommit(c.sha, x.opportunityId)}
                      >{shortName(oppById.get(x.opportunityId))} <span className="candScore">{(x.score * 100).toFixed(0)}%</span></button>
                    ))}
                    {opportunities.length > 0 && (
                      <select
                        className="candMore"
                        value=""
                        title="Rattacher à un autre projet existant"
                        onChange={(e) => { if (e.target.value) classifyCommit(c.sha, e.target.value); }}
                      >
                        <option value="">+ autre projet…</option>
                        {opportunities.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
                      </select>
                    )}
                    <button type="button" className="candChip candNone" onClick={() => classifyCommit(c.sha, '__none__')}>Aucun</button>
                    {draft === undefined ? (
                      <button type="button" className="candChip candNew" onClick={() => setNewProjFor(prev => ({ ...prev, [c.sha]: '' }))}>+ Nouveau projet…</button>
                    ) : (
                      <span className="candNewForm">
                        <input
                          className="candNewInput"
                          autoFocus
                          placeholder="Nom du projet"
                          value={draft}
                          onChange={(e) => setNewProjFor(prev => ({ ...prev, [c.sha]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') createAndAssign(c.sha, draft); if (e.key === 'Escape') setNewProjFor(prev => { const n = { ...prev }; delete n[c.sha]; return n; }); }}
                        />
                        <button type="button" className="btn btnPrimary" disabled={!draft.trim()} onClick={() => createAndAssign(c.sha, draft)}>Créer</button>
                        <button type="button" className="btn" onClick={() => setNewProjFor(prev => { const n = { ...prev }; delete n[c.sha]; return n; })}>✕</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeIds.size === 0 ? (
        <p className="muted staffingEmpty">Aucune activité Git résolue sur les {WINDOW_DAYS} derniers jours. Lance une analyse (panneau ⎇ Git) et rattache les auteurs (github login) pour peupler la timeline.</p>
      ) : (
        <div className="staffingMatrixWrap">
          <table className="staffingMatrix timeline">
            <thead>
              <tr>
                <th className="cornerCell">Équipe / Dev</th>
                {days.map(d => <th key={d.key} className="dayCol">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(group => (
                <React.Fragment key={group.key}>
                  <tr className="squadRow">
                    <td className="squadCell">{group.label} <span className="squadCount">· {group.members.length}</span></td>
                    {days.map(d => <td key={d.key} className="squadAgg" />)}
                  </tr>
                  {group.members.map(p => {
                    const dm = grid.get(p._id) || new Map();
                    return (
                      <tr key={p._id} className="personRow">
                        <td className="personCell"><span className="personName">{personLabel(p)}</span></td>
                        {days.map(d => {
                          const cell = dm.get(d.key);
                          return (
                            <td key={d.key} className="dayCell">
                              {cell && [...cell.entries()].map(([oppId, chip]) => (
                                <span
                                  key={oppId}
                                  className={`projChip ${colorClass(oppId)} clickable`}
                                  title={`Projet : ${chip.label} (cliquer pour ouvrir)`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => navigateTo({ name: 'opportunity', opportunityId: oppId })}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo({ name: 'opportunity', opportunityId: oppId }); } }}
                                >{shortName(chip.label)}</span>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Effacer les données Staffing ?"
        icon="🗑"
        actions={[
          <button key="cancel" type="button" className="btn" onClick={() => setConfirmWipe(false)}>Annuler</button>,
          <button key="ok" type="button" className="btn btnDanger" disabled={wiping} onClick={wipeData}>{wiping ? 'Suppression…' : 'Tout effacer'}</button>
        ]}
      >
        <p>Supprime <strong>tous les commits, tous les projets</strong> (y compris ceux créés à la main), le staffing et les classifications.</p>
        <p>Conserve le mapping <strong>github → personne</strong> et les équipes.</p>
        <p className="gitWarn">Action irréversible.</p>
      </Modal>
    </div>
  );
};
