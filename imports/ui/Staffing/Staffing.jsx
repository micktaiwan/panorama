import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { PeopleCollection } from '/imports/api/people/collections';
import { handlesOf } from '/imports/api/people/githubHandles';
import { TeamsCollection } from '/imports/api/teams/collections';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { CommitsCollection } from '/imports/api/staffing/gitCollections';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { CommitAnalysisModal } from '/imports/ui/Staffing/CommitAnalysisModal/CommitAnalysisModal.jsx';
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
// Staffing only shows the technical org. "Data" is an empty top-level team today
// (data folks live in Tech with subteam=Data) — kept for future-proofing.
const STAFFING_TEAM_NAMES = ['tech', 'sre/devops', 'data'];
// People always shown regardless of team, so the org tree keeps a real root (CTO above the VP/leads).
const STAFFING_WHITELIST_EMAILS = ['mickael@lempire.co'];
const MAX_DEPTH = 6;
// Two roles that don't contain "lead" but should still get the lead-row background:
// the CTO (Mickael) and the VP of Engineering (Corentin Léotard).
const LEAD_FOND_EXCEPTIONS = new Set(['mickael@lempire.co', 'corentin@lempire.co']);
const isWhitelisted = (p) => STAFFING_WHITELIST_EMAILS.includes(String(p?.email || '').toLowerCase());

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
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null); // person _id or '__loose__'
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
  const [creatingShas, setCreatingShas] = useState(() => new Set()); // shas with an in-flight project creation
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [analyzeSha, setAnalyzeSha] = useState(null);

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

  const oppById = useMemo(() => {
    const m = new Map();
    opportunities.forEach(o => m.set(o._id, o.name));
    return m;
  }, [opportunities]);
  // Alphabetical list for the project-selection dropdowns (kanban order stays for the board).
  const sortedOpportunities = useMemo(
    () => [...opportunities].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })),
    [opportunities]
  );

  // Resolve a commit author to a person: GitHub login (any handle) > email.
  const resolver = useMemo(() => {
    const byLogin = new Map();
    const byEmail = new Map();
    people.forEach(p => {
      handlesOf(p).forEach(login => byLogin.set(login, p._id));
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

  // Teams shown in the Staffing org: technical org only (Tech, SRE/DevOps, Data).
  const staffingTeamIds = useMemo(() => {
    const wanted = new Set(STAFFING_TEAM_NAMES);
    return new Set(teams.filter(t => wanted.has(String(t.name || '').toLowerCase())).map(t => t._id));
  }, [teams]);
  const staffingTeams = useMemo(
    () => teams.filter(t => staffingTeamIds.has(t._id)).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [teams, staffingTeamIds]
  );

  // Population = non-left people in the technical org (+ whitelist), optionally narrowed by the team filter.
  // Whitelisted people (e.g. the CTO) always appear so the tree stays rooted, even under a team filter.
  const population = useMemo(
    () => people.filter(p => !p.left && (isWhitelisted(p) || ((p.teamId && staffingTeamIds.has(p.teamId)) && (!teamId || p.teamId === teamId)))),
    [people, staffingTeamIds, teamId]
  );

  // Build the managerId tree over the population:
  // - treeRows: DFS-flattened [{ person, depth }] for every node that belongs to a tree (root WITH reports, then descendants).
  // - looseRows: roots WITHOUT reports (unclassified leaves) → the "Sans manager" bucket.
  // A managerId pointing outside the population makes the person an effective root.
  const { treeRows, looseRows } = useMemo(() => {
    const inSet = new Set(population.map(p => p._id));
    const parentOf = new Map(); // id -> effective parent id (within population) or null
    population.forEach(p => parentOf.set(p._id, (p.managerId && inSet.has(p.managerId)) ? p.managerId : null));
    const childrenOf = new Map(); // parentId -> [person]
    population.forEach(p => {
      const par = parentOf.get(p._id);
      if (!par) return;
      if (!childrenOf.has(par)) childrenOf.set(par, []);
      childrenOf.get(par).push(p);
    });
    const sortP = (a, b) => personLabel(a).localeCompare(personLabel(b));
    const roots = population.filter(p => parentOf.get(p._id) === null);
    const treeHeads = roots.filter(p => childrenOf.has(p._id)).sort(sortP);
    const loose = roots.filter(p => !childrenOf.has(p._id)).sort(sortP);
    const rows = [];
    const walk = (p, depth) => {
      rows.push({ person: p, depth });
      (childrenOf.get(p._id) || []).slice().sort(sortP).forEach(k => walk(k, depth + 1));
    };
    treeHeads.forEach(h => walk(h, 0));
    return { treeRows: rows, looseRows: loose };
  }, [population]);

  // Cycle guard (client-side pre-check; server is authoritative). Walks the REAL managerId
  // chain from the drop target: if it reaches the dragged person, the link would cycle.
  const wouldCreateCycle = (draggedId, targetId) => {
    if (draggedId === targetId) return true;
    let cursor = targetId;
    const seen = new Set();
    while (cursor) {
      if (cursor === draggedId) return true;
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = peopleById.get(cursor)?.managerId || null;
    }
    return false;
  };

  const reattach = (personId, managerId) => {
    Meteor.call('people.update', personId, { managerId: managerId || '' }, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      const who = personLabel(peopleById.get(personId));
      const msg = managerId ? `${who} → ${personLabel(peopleById.get(managerId))}` : `${who} détaché`;
      notify({ message: msg, kind: 'success' });
    });
  };

  const onDragStartPerson = (e, personId) => {
    setDraggingId(personId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', personId);
  };
  const onDragEndPerson = () => { setDraggingId(null); setDragOverKey(null); };
  const allowDrop = (e, overKey) => { e.preventDefault(); if (dragOverKey !== overKey) setDragOverKey(overKey); };
  const clearDropHighlight = (overKey) => setDragOverKey(prev => (prev === overKey ? null : prev));

  const onDropOnPerson = (e, targetId) => {
    e.preventDefault();
    const dragged = draggingId || e.dataTransfer.getData('text/plain');
    setDragOverKey(null); setDraggingId(null);
    if (!dragged || dragged === targetId) return;
    if (peopleById.get(dragged)?.managerId === targetId) return; // already attached there
    if (wouldCreateCycle(dragged, targetId)) { notify({ message: 'Rattachement refusé : créerait un cycle hiérarchique', kind: 'error' }); return; }
    reattach(dragged, targetId);
  };
  const onDropLoose = (e) => {
    e.preventDefault();
    const dragged = draggingId || e.dataTransfer.getData('text/plain');
    setDragOverKey(null); setDraggingId(null);
    if (!dragged || !peopleById.get(dragged)?.managerId) return; // already detached
    reattach(dragged, '');
  };

  const renderPersonRow = (p, depth) => {
    const dm = grid.get(p._id) || new Map();
    const lvl = Math.min(depth, MAX_DEPTH);
    const isLead = /lead/i.test(p.role || '') || LEAD_FOND_EXCEPTIONS.has(String(p.email || '').toLowerCase());
    return (
      <tr key={p._id} className={`personRow${isLead ? ' leadRow' : ''}${draggingId === p._id ? ' dragging' : ''}`}>
        <td
          className={`personCell lvl${lvl}${dragOverKey === p._id ? ' dropTarget' : ''}`}
          onDragOver={(e) => allowDrop(e, p._id)}
          onDragLeave={() => clearDropHighlight(p._id)}
          onDrop={(e) => onDropOnPerson(e, p._id)}
        >
          <span className="personHandle">
            <span
              className="dragGrip"
              draggable
              onDragStart={(e) => onDragStartPerson(e, p._id)}
              onDragEnd={onDragEndPerson}
              title="Glisser pour rattacher à un manager (ou vers « Sans manager » pour détacher)"
            >⋮⋮</span>
            <button
              type="button"
              className="personName linklike"
              onClick={() => navigateTo({ name: 'staffingPerson', personId: p._id })}
              title="Voir la fiche et les commits"
            >{personLabel(p)}</button>
            {p.role ? <span className="personRole">{p.role}</span> : null}
          </span>
        </td>
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
  };

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
    if (running) return;
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
      if (res?.coalesced) { notify({ message: 'Recalcul déjà en cours — relance groupée', kind: 'info' }); return; }
      notify({ message: `Propositions recalculées (${res.ranked}/${res.total})`, kind: 'success' });
    });
  };

  // Attach an unresolved git login to a person: ADD it to their handles (never overwrite),
  // so a person can accumulate several GitHub logins.
  const setGithubUsername = (personId, login) => {
    const person = people.find(p => p._id === personId);
    const next = [...handlesOf(person), String(login || '').trim().toLowerCase()];
    Meteor.call('people.update', personId, { githubUsernames: next }, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      notify({ message: `Rattaché : ${login}`, kind: 'success' });
    });
  };

  const classifyCommit = (sha, opportunityId) => Meteor.call('staffing.setCommitOpportunity', sha, opportunityId, (err) => {
    if (err) notify({ message: err.reason || 'Erreur', kind: 'error' });
  });
  const createAndAssign = (sha, name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (creatingShas.has(sha)) return; // guard against double-submit (Enter + click / double Enter)
    setCreatingShas(prev => new Set(prev).add(sha));
    Meteor.call('opportunities.insert', { name: trimmed }, (err, newId) => {
      setCreatingShas(prev => { const n = new Set(prev); n.delete(sha); return n; });
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
              <option value="">Toutes (Tech + SRE + Data)</option>
              {staffingTeams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
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
                    <button
                      type="button"
                      className="candChip candAnalyze"
                      title="Analyse approfondie : récupère le commit complet (message, fichiers, stats) et propose des projets"
                      onClick={() => setAnalyzeSha(c.sha)}
                    >🔬 Analyser</button>
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
                        {sortedOpportunities.map(o => <option key={o._id} value={o._id}>{o.name}</option>)}
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
                          onKeyDown={(e) => { if (e.key === 'Enter' && !creatingShas.has(c.sha)) createAndAssign(c.sha, draft); if (e.key === 'Escape') setNewProjFor(prev => { const n = { ...prev }; delete n[c.sha]; return n; }); }}
                        />
                        <button type="button" className="btn btnPrimary" disabled={!draft.trim() || creatingShas.has(c.sha)} onClick={() => createAndAssign(c.sha, draft)}>{creatingShas.has(c.sha) ? 'Création…' : 'Créer'}</button>
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

      {population.length === 0 ? (
        <p className="muted staffingEmpty">Aucune personne dans l'org technique (Tech / SRE / Data) pour ce filtre. Vérifie les équipes dans People.</p>
      ) : (
        <div className="staffingMatrixWrap">
          <table className="staffingMatrix timeline">
            <thead>
              <tr>
                <th className="cornerCell">Encadrement / Dev</th>
                {days.map(d => <th key={d.key} className="dayCol">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {treeRows.map(({ person, depth }) => renderPersonRow(person, depth))}
              <tr className="squadRow looseRow">
                <td
                  className={`squadCell looseCell${dragOverKey === '__loose__' ? ' dropTarget' : ''}`}
                  onDragOver={(e) => allowDrop(e, '__loose__')}
                  onDragLeave={() => clearDropHighlight('__loose__')}
                  onDrop={onDropLoose}
                >
                  Sans manager <span className="squadCount">· {looseRows.length}</span>
                  <span className="looseHint">déposer ici = détacher</span>
                </td>
                {days.map(d => (
                  <td
                    key={d.key}
                    className={`squadAgg${dragOverKey === '__loose__' ? ' dropTarget' : ''}`}
                    onDragOver={(e) => allowDrop(e, '__loose__')}
                    onDrop={onDropLoose}
                  />
                ))}
              </tr>
              {looseRows.map(p => renderPersonRow(p, 0))}
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

      {analyzeSha && (
        <CommitAnalysisModal
          key={analyzeSha}
          sha={analyzeSha}
          headline={(reviewCommits.find(c => c.sha === analyzeSha) || {}).message}
          opportunities={opportunities}
          onClassify={classifyCommit}
          onClose={() => setAnalyzeSha(null)}
        />
      )}
    </div>
  );
};
