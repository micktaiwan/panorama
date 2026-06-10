import React, { useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { PeopleCollection } from '/imports/api/people/collections';
import { handlesOf } from '/imports/api/people/githubHandles';
import { TeamsCollection } from '/imports/api/teams/collections';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { CommitsCollection, BranchClassificationsCollection } from '/imports/api/staffing/gitCollections';
import { navigateTo } from '/imports/ui/router.js';
import { notify } from '/imports/ui/utils/notify.js';
import './StaffingPerson.css';

const personLabel = (p) => `${p?.name || ''}${p?.lastName ? ' ' + p.lastName : ''}`.trim();
const fmtDateTime = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const colorClass = (id) => {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `chip-c${h % 8}`;
};
const shortName = (name) => {
  const n = String(name || '').trim();
  return n.length > 22 ? n.slice(0, 21) + '…' : n;
};

export const StaffingPerson = ({ personId }) => {
  const loadingPeople = useSubscribe('people.all');
  const loadingTeams = useSubscribe('teams.all');
  const loadingOpps = useSubscribe('opportunities.all');
  useSubscribe('commits.recent', 2000);
  useSubscribe('branchClassifications.all');

  const person = useTracker(() => PeopleCollection.findOne({ _id: personId }) || null, [personId]);
  const people = useFind(() => PeopleCollection.find({}, { sort: { normalizedName: 1 } }));
  const teams = useFind(() => TeamsCollection.find({}));
  const opportunities = useFind(() => OpportunitiesCollection.find({}));
  const commits = useFind(() => CommitsCollection.find({}, { sort: { committedAt: -1 } }));
  const branchClassifications = useFind(() => BranchClassificationsCollection.find({}));

  const [fetching, setFetching] = useState(false);

  const fetchCommits = () => {
    if (fetching) return;
    setFetching(true);
    Meteor.call('staffing.fetchPersonCommits', personId, (err, res) => {
      setFetching(false);
      if (err) { notify({ message: err.reason || 'Erreur lors du fetch GitHub', kind: 'error' }); return; }
      const n = res?.commitsIngested || 0;
      const r = res?.ranked || 0;
      notify({ message: `${n} commit${n > 1 ? 's' : ''} récupéré${n > 1 ? 's' : ''} · ${r} proposition${r > 1 ? 's' : ''} calculée${r > 1 ? 's' : ''}`, kind: 'success' });
    });
  };

  // Classify a commit onto a project straight from its row (select). Empty value = no-op.
  const classifyCommit = (sha, opportunityId) => {
    if (!opportunityId) return;
    Meteor.call('staffing.setCommitOpportunity', sha, opportunityId, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur lors du classement', kind: 'error' }); return; }
      notify({ message: 'Commit classé', kind: 'success' });
    });
  };

  const loading = loadingPeople() || loadingTeams() || loadingOpps();

  const sortedOpportunities = useMemo(
    () => [...opportunities].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })),
    [opportunities]
  );

  const peopleById = useMemo(() => {
    const m = new Map();
    people.forEach(p => m.set(p._id, p));
    return m;
  }, [people]);
  const teamName = useMemo(() => {
    const m = new Map();
    teams.forEach(t => m.set(t._id, t.name));
    return (id) => m.get(id) || '';
  }, [teams]);
  const oppById = useMemo(() => {
    const m = new Map();
    opportunities.forEach(o => m.set(o._id, o.name));
    return m;
  }, [opportunities]);
  const branchOpp = useMemo(() => {
    const m = new Map();
    branchClassifications.forEach(b => { if (b.opportunityId) m.set(b.branch, b.opportunityId); });
    return m;
  }, [branchClassifications]);

  // Does this commit belong to `person`? Match by any GitHub login > email.
  const isOwnCommit = useMemo(() => {
    const logins = new Set(handlesOf(person));
    const email = String(person?.email || '').toLowerCase();
    return (c) => {
      if (c.authorLogin && logins.has(c.authorLogin.toLowerCase())) return true;
      if (email && c.authorEmail && c.authorEmail.toLowerCase() === email) return true;
      return false;
    };
  }, [person]);

  const ownCommits = useMemo(() => commits.filter(isOwnCommit), [commits, isOwnCommit]);

  // Effective opportunity for a commit: per-commit override wins, else its scope's classification.
  const effOpp = (c) => c.opportunityId || branchOpp.get(c.scope || 'autre') || null;

  const reports = useMemo(
    () => people.filter(p => p.managerId === personId && !p.left).sort((a, b) => personLabel(a).localeCompare(personLabel(b))),
    [people, personId]
  );

  const stats = useMemo(() => {
    const projects = new Set();
    let classified = 0;
    ownCommits.forEach(c => { const o = effOpp(c); if (o && oppById.has(o)) { projects.add(o); classified += 1; } });
    return { total: ownCommits.length, classified, projects: projects.size };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownCommits, oppById, branchOpp]);

  if (loading) return <div className="staffPerson"><p className="muted">Loading…</p></div>;
  if (!person) {
    return (
      <div className="staffPerson">
        <a href="#/staffing" className="staffPersonBack" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'staffing' }); }}>← Staffing</a>
        <p className="muted">Personne introuvable.</p>
      </div>
    );
  }

  const manager = person.managerId ? peopleById.get(person.managerId) : null;
  const ghLogins = handlesOf(person);

  return (
    <div className="staffPerson">
      <a href="#/staffing" className="staffPersonBack" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'staffing' }); }}>← Staffing</a>

      <div className="staffPersonHead">
        <h2 className="staffPersonName">{personLabel(person)}</h2>
        {person.role ? <span className="staffPersonRole">{person.role}</span> : null}
      </div>

      <dl className="staffPersonFacts">
        {person.email ? <><dt>Email</dt><dd><a href={`mailto:${person.email}`}>{person.email}</a></dd></> : null}
        <dt>Équipe</dt>
        <dd>{teamName(person.teamId) || '—'}{person.subteam ? <span className="staffSubteam"> · {person.subteam}</span> : null}</dd>
        <dt>Manager</dt>
        <dd>
          {manager
            ? <button type="button" className="staffPersonLink" onClick={() => navigateTo({ name: 'staffingPerson', personId: manager._id })}>{personLabel(manager)}</button>
            : '—'}
        </dd>
        <dt>Rattachés</dt>
        <dd>
          {reports.length === 0 ? '—' : reports.map((r, i) => (
            <React.Fragment key={r._id}>
              {i > 0 ? ', ' : ''}
              <button type="button" className="staffPersonLink" onClick={() => navigateTo({ name: 'staffingPerson', personId: r._id })}>{personLabel(r)}</button>
            </React.Fragment>
          ))}
        </dd>
        {ghLogins.length > 0 ? <><dt>GitHub</dt><dd className="staffMono">{ghLogins.join(', ')}</dd></> : null}
        {person.arrivalDate ? <><dt>Arrivée</dt><dd>{fmtDate(person.arrivalDate)}</dd></> : null}
      </dl>

      <div className="staffPersonStats">
        <span className="staffStatChip">{stats.total} commits</span>
        <span className="staffStatChip">{stats.classified} classés</span>
        <span className="staffStatChip">{stats.projects} projet{stats.projects > 1 ? 's' : ''}</span>
      </div>

      <div className="staffCommitsHead">
        <h3 className="staffSectionTitle">Commits</h3>
        <div className="staffFetchWrap">
          <span className="staffFetchHint">Récupère ses commits des 3 derniers jours sur la branche par défaut</span>
          <button
            type="button"
            className="staffFetchBtn"
            disabled={fetching || (ghLogins.length === 0 && !person.email)}
            title={(ghLogins.length === 0 && !person.email) ? 'Pas de github login ni d’email pour cette personne' : 'Récupérer ses derniers commits depuis GitHub'}
            onClick={fetchCommits}
          >
            {fetching ? 'Fetch en cours…' : '⟳ Fetch git (3j)'}
          </button>
        </div>
      </div>
      {ownCommits.length === 0 ? (
        <p className="muted">
          {ghLogins.length > 0 || person.email
            ? 'Aucun commit ingéré pour cette personne (fenêtre chargée).'
            : 'Pas de github login ni d’email pour résoudre les commits de cette personne.'}
        </p>
      ) : (
        <table className="staffCommits">
          <thead>
            <tr>
              <th>Date</th>
              <th>GitHub</th>
              <th>Projet</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {ownCommits.slice(0, 200).map(c => {
              const oid = effOpp(c);
              const known = oid && oppById.has(oid);
              return (
                <tr key={c.sha}>
                  <td className="staffCommitDate">{fmtDateTime(c.committedAt)}</td>
                  <td className="staffMono staffCommitAuthor" title={c.authorEmail || ''}>{c.authorLogin || c.authorEmail || '—'}</td>
                  <td>
                    {known ? (
                      <span
                        className={`projChip ${colorClass(oid)} clickable`}
                        title={`Projet : ${oppById.get(oid)} (cliquer pour ouvrir)`}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigateTo({ name: 'opportunity', opportunityId: oid })}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo({ name: 'opportunity', opportunityId: oid }); } }}
                      >{shortName(oppById.get(oid))}</span>
                    ) : (
                      <select
                        className="staffCommitClassify"
                        defaultValue=""
                        onChange={(e) => classifyCommit(c.sha, e.target.value)}
                        title="Classer ce commit sur un projet"
                      >
                        <option value="">à classer…</option>
                        {sortedOpportunities.map(o => (
                          <option key={o._id} value={o._id}>{o.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="staffCommitMsg" title={c.message}>{c.message}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
