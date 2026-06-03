import React, { useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { OpportunitiesCollection } from '/imports/api/opportunities/collections';
import { CommitsCollection, BranchClassificationsCollection } from '/imports/api/staffing/gitCollections';
import { PeopleCollection } from '/imports/api/people/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { navigateTo } from '/imports/ui/router.js';
import { notify } from '/imports/ui/utils/notify.js';
import './OpportunityDetail.css';

const personLabel = (p) => `${p?.name || ''}${p?.lastName ? ' ' + p.lastName : ''}`.trim();
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const STATUS_OPTIONS = [
  { value: 'idea', label: 'Idée' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'cooldown', label: 'Cooldown' },
  { value: 'shipped', label: 'Livré' },
  { value: 'paused', label: 'En pause' }
];

export const OpportunityDetail = ({ opportunityId }) => {
  const loadingOpps = useSubscribe('opportunities.all');
  const loadingCommits = useSubscribe('commits.byOpportunity', opportunityId);
  const loadingPeople = useSubscribe('people.all');
  useSubscribe('branchClassifications.all');

  const opp = useTracker(() => OpportunitiesCollection.findOne({ _id: opportunityId }) || null, [opportunityId]);
  const opportunities = useFind(() => OpportunitiesCollection.find({}, { sort: { name: 1 } }));
  const people = useFind(() => PeopleCollection.find({}));
  const commits = useFind(() => CommitsCollection.find({}, { sort: { committedAt: -1 } }));
  const branchClassifications = useFind(() => BranchClassificationsCollection.find({}));

  const loading = loadingOpps() || loadingCommits() || loadingPeople();

  const peopleById = useMemo(() => {
    const m = new Map();
    people.forEach(p => m.set(p._id, p));
    return m;
  }, [people]);

  // scope -> opportunityId (classification cache).
  const branchOpp = useMemo(() => {
    const m = new Map();
    branchClassifications.forEach(b => { if (b.opportunityId) m.set(b.branch, b.opportunityId); });
    return m;
  }, [branchClassifications]);

  // Resolve a commit author to a person: githubUsername (login) > email.
  const resolveAuthor = useMemo(() => {
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

  // Only commits whose EFFECTIVE opportunity is this one (override wins over scope).
  const ownCommits = useMemo(() => commits.filter(c => {
    const eff = c.opportunityId || branchOpp.get(c.scope || 'autre') || null;
    return eff === opportunityId;
  }), [commits, branchOpp, opportunityId]);

  const reassignOptions = useMemo(
    () => opportunities.filter(o => o._id !== opportunityId).map(o => ({ value: o._id, label: o.name })),
    [opportunities, opportunityId]
  );

  const updateName = (name) => Meteor.call('opportunities.update', opportunityId, { name }, (err) => {
    if (err) notify({ message: err.reason || 'Erreur', kind: 'error' });
  });
  const updateStatus = (status) => Meteor.call('opportunities.update', opportunityId, { status }, (err) => {
    if (err) notify({ message: err.reason || 'Erreur', kind: 'error' });
  });
  const rerankAfterKeywords = () => {
    notify({ message: 'Mots-clés enregistrés — recalcul des propositions…', kind: 'info' });
    Meteor.call('staffing.rerankUnclassified', (e, res) => {
      if (e) { notify({ message: e.reason || 'Erreur recalcul', kind: 'error' }); return; }
      notify({ message: `Propositions recalculées (${res.ranked}/${res.total})`, kind: 'success' });
    });
  };
  const updateKeywords = (str) => Meteor.call('opportunities.update', opportunityId, { keywords: str }, (err) => {
    if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
    rerankAfterKeywords();
  });

  // --- Keyword suggestions (manual, LLM, based on ALL classified commits) ---
  const [kwLoading, setKwLoading] = useState(false);
  const [kwSuggestions, setKwSuggestions] = useState(null); // null = idle, [] = none, [...] = proposals
  const [kwSelected, setKwSelected] = useState(() => new Set());

  const suggestKeywords = () => {
    setKwLoading(true);
    Meteor.call('staffing.suggestKeywords', opportunityId, (err, res) => {
      setKwLoading(false);
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      const kws = res?.keywords || [];
      setKwSuggestions(kws);
      setKwSelected(new Set(kws));
      if (kws.length === 0) notify({ message: `Aucun nouveau mot-clé proposé (${res?.commitsConsidered || 0} commits analysés)`, kind: 'info' });
    });
  };
  const toggleKw = (k) => setKwSelected(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const addKeywords = (toAdd) => {
    if (!toAdd || toAdd.length === 0) return;
    const merged = [...new Set([...(opp?.keywords || []), ...toAdd])];
    Meteor.call('opportunities.update', opportunityId, { keywords: merged }, (err) => {
      if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
      setKwSuggestions(null);
      notify({ message: `${toAdd.length} mot(s)-clé(s) ajouté(s)`, kind: 'success' });
      rerankAfterKeywords();
    });
  };
  const reassignCommit = (sha, targetOppId) => Meteor.call('staffing.setCommitOpportunity', sha, targetOppId, (err) => {
    if (err) { notify({ message: err.reason || 'Erreur', kind: 'error' }); return; }
    notify({ message: targetOppId ? 'Commit rattaché' : 'Commit détaché', kind: 'success' });
  });

  if (loading) return <div className="oppDetail"><p className="muted">Loading…</p></div>;
  if (!opp) {
    return (
      <div className="oppDetail">
        <a href="#/staffing" className="oppBack" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'staffing' }); }}>← Staffing</a>
        <p className="muted">Projet introuvable.</p>
      </div>
    );
  }

  const contributors = [...new Set(ownCommits.map(c => resolveAuthor(c)).filter(Boolean))]
    .map(pid => personLabel(peopleById.get(pid))).filter(Boolean);

  return (
    <div className="oppDetail">
      <a href="#/staffing" className="oppBack" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'staffing' }); }}>← Staffing</a>

      <div className="oppDetailHead">
        <h2 className="oppDetailName">
          <InlineEditable value={opp.name} onSubmit={updateName} placeholder="Nom du projet" />
        </h2>
        <div className="oppDetailMeta">
          <label className="oppStatusField">
            Statut
            <InlineEditable as="select" value={opp.status || 'in_progress'} options={STATUS_OPTIONS} onSubmit={updateStatus} />
          </label>
          {opp.cycle ? <span className="oppCycle">Cycle : {opp.cycle}</span> : null}
          {opp.notionUrl ? <a className="oppNotion" href={opp.notionUrl} target="_blank" rel="noreferrer">Notion ↗</a> : null}
        </div>
        <label className="oppKeywordsField">
          <span className="oppKeywordsLabel">Mots-clés (aident la classification des commits)</span>
          <InlineEditable
            value={(opp.keywords || []).join(', ')}
            placeholder="ex. sre, terraform, infra, kibana"
            onSubmit={updateKeywords}
            fullWidth
          />
        </label>
        <div className="oppKwSuggest">
          <button type="button" className="btn" disabled={kwLoading} onClick={suggestKeywords}>
            {kwLoading ? 'Analyse des commits…' : '💡 Suggérer des mots-clés manquants'}
          </button>
          {Array.isArray(kwSuggestions) && kwSuggestions.length > 0 && (
            <div className="oppKwProposals">
              {kwSuggestions.map(k => (
                <button
                  key={k}
                  type="button"
                  className={`oppKwChip ${kwSelected.has(k) ? 'sel' : ''}`}
                  onClick={() => toggleKw(k)}
                >{k}</button>
              ))}
              <button type="button" className="btn btnPrimary" disabled={kwSelected.size === 0} onClick={() => addKeywords([...kwSelected])}>Ajouter ({kwSelected.size})</button>
              <button type="button" className="btn" onClick={() => setKwSuggestions(null)}>✕</button>
            </div>
          )}
        </div>
      </div>

      <div className="oppStats">
        <span className="oppStatChip">{ownCommits.length} commits</span>
        <span className="oppStatChip">{contributors.length} contributeur{contributors.length > 1 ? 's' : ''}</span>
        {contributors.length > 0 && <span className="oppContribs">{contributors.join(', ')}</span>}
      </div>

      <h3 className="oppSectionTitle">Commits rattachés</h3>
      {ownCommits.length === 0 ? (
        <p className="muted">Aucun commit rattaché à ce projet.</p>
      ) : (
        <table className="oppCommits">
          <thead>
            <tr>
              <th>Date</th>
              <th>Auteur</th>
              <th>Scope</th>
              <th>Message</th>
              <th>Rattacher à…</th>
            </tr>
          </thead>
          <tbody>
            {ownCommits.map(c => {
              const pid = resolveAuthor(c);
              const overridden = !!c.opportunityId;
              return (
                <tr key={c.sha}>
                  <td className="oppCommitDate">{fmtDate(c.committedAt)}</td>
                  <td>{pid ? personLabel(peopleById.get(pid)) : (c.authorLogin || c.authorEmail || '—')}</td>
                  <td><span className="oppCommitScope">{c.scope || 'autre'}{overridden ? ' ✎' : ''}</span></td>
                  <td className="oppCommitMsg" title={c.message}>{c.message}</td>
                  <td>
                    <select
                      className="oppReassign"
                      value=""
                      onChange={(e) => { if (e.target.value !== '') reassignCommit(c.sha, e.target.value === '__clear__' ? '' : e.target.value); e.target.value = ''; }}
                    >
                      <option value="">déplacer…</option>
                      {overridden && <option value="__clear__">↩ rendre au scope ({c.scope})</option>}
                      {reassignOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
