import React, { useEffect, useMemo, useState } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { PeopleCollection } from '/imports/api/people/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { TeamsCollection } from '/imports/api/teams/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { PeopleFilterBar } from '/imports/ui/People/components/PeopleFilterBar.jsx';
import { TeamsTable } from '/imports/ui/People/components/TeamsTable.jsx';
import { Collapsible } from '/imports/ui/components/Collapsible/Collapsible.jsx';
import { PeopleTable } from '/imports/ui/People/components/PeopleTable.jsx';
import { loadPeopleFilters, savePeopleTeamFilter, savePeopleTextFilter } from '/imports/ui/People/filters.js';
import { useRowHighlight } from '/imports/ui/hooks/useRowHighlight.js';
import { useHashHighlight } from '/imports/ui/hooks/useHashHighlight.js';
import './PeoplePage.css';

export const PeoplePage = ({ highlightId: externalHighlightId }) => {
  const ready = useTracker(() => Meteor.subscribe('people.all').ready(), []);
  const teamsReady = useTracker(() => Meteor.subscribe('teams.all').ready(), []);
  const people = useTracker(() => PeopleCollection.find({}, { sort: { left: 1, name: 1, lastName: 1 } }).fetch());
  const teams = useTracker(() => TeamsCollection.find({}, { sort: { name: 1 } }).fetch(), [teamsReady]);
  const teamCounts = useMemo(() => {
    const counts = new Map();
    (people || []).forEach(p => {
      const tid = String(p.teamId || '');
      if (!tid) return;
      counts.set(tid, (counts.get(tid) || 0) + 1);
    });
    return counts;
  }, [JSON.stringify((people || []).map(p => [p._id, p.teamId]))]);
  const [teamCreateOpen, setTeamCreateOpen] = useState(false);
  const [teamCreateName, setTeamCreateName] = useState('');
  const [teamDeleteId, setTeamDeleteId] = useState(null);
  const [personDeleteId, setPersonDeleteId] = useState(null);
  const [filter, setFilter] = useState(() => loadPeopleFilters().text);
  const [teamFilter, setTeamFilter] = useState(() => loadPeopleFilters().team);
  const deepLinkId = useHashHighlight('people', '#/people');
  const [highlightId, setHighlightId] = useState(deepLinkId || null);
  useEffect(() => {
    if (externalHighlightId) setHighlightId(externalHighlightId);
  }, [externalHighlightId]);
  useRowHighlight(highlightId, '.peopleTable tbody tr', () => setHighlightId(null));
  const normalize = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  useEffect(() => { savePeopleTextFilter(filter || ''); }, [filter]);
  useEffect(() => { savePeopleTeamFilter(teamFilter || ''); }, [teamFilter]);
  const filtered = useMemo(() => {
    const f = normalize(filter.trim());
    const base = people.filter(p => {
      const inName = normalize(p.name || '').includes(f);
      const inLast = normalize(p.lastName || '').includes(f);
      const inRole = normalize(p.role || '').includes(f);
      const inEmail = normalize(p.email || '').includes(f);
      const inAliases = Array.isArray(p.aliases) && p.aliases.some(a => normalize(a).includes(f));
      const inNotes = normalize(p.notes || '').includes(f);
      return inName || inLast || inRole || inEmail || inAliases || inNotes;
    });
    if (!teamFilter) return base;
    if (teamFilter === '__none__') return base.filter(p => !p.teamId);
    return base.filter(p => String(p.teamId || '') === teamFilter);
  }, [
    JSON.stringify(people.map(p => [
      p._id,
      p.name,
      p.lastName,
      p.role,
      p.email,
      (p.aliases || []).join('|'),
      p.notes,
      p.left,
      p.teamId
    ])),
    filter,
    teamFilter
  ]);
  const sorted = useMemo(() => {
    const list = Array.isArray(filtered) ? filtered.slice() : [];
    const cmp = (a, b) => {
      // Left at the end
      const aLeft = !!a.left; const bLeft = !!b.left;
      if (aLeft !== bLeft) return aLeft ? 1 : -1;
      const na = normalize(a.name || '');
      const nb = normalize(b.name || '');
      if (na !== nb) return na < nb ? -1 : 1;
      const la = normalize(a.lastName || '');
      const lb = normalize(b.lastName || '');
      if (la !== lb) return la < lb ? -1 : 1;
      return 0;
    };
    return list.sort(cmp);
  }, [JSON.stringify(filtered.map(p => [
    p._id,
    p.left,
    p.name,
    p.lastName,
    p.role,
    p.email,
    (p.aliases || []).join('|'),
    p.notes
  ]))]);
  return (
    <div className="peoplePage">
      <h2>People</h2>
      <Collapsible title="" defaultOpen={false} toggleTextClosed="Show teams" toggleTextOpen="Hide teams">
        <TeamsTable
          teams={teams}
          teamCounts={teamCounts}
          onNewTeamClick={() => { setTeamCreateName(''); setTeamCreateOpen(true); }}
          onDeleteTeam={(id) => setTeamDeleteId(id)}
          onRenameTeam={(id, name) => Meteor.call('teams.update', id, { name })}
        />
      </Collapsible>
      <Modal
        open={teamCreateOpen}
        onClose={() => setTeamCreateOpen(false)}
        title="New team"
        actions={[
          <button key="cancel" className="btn" onClick={() => setTeamCreateOpen(false)}>Cancel</button>,
          <button key="create" className="btn ml8" onClick={() => {
            const name = String(teamCreateName || '').trim();
            if (!name) { setTeamCreateOpen(false); return; }
            Meteor.call('teams.insert', { name }, () => setTeamCreateOpen(false));
          }}>Create</button>
        ]}
      >
        <input
          className="peopleFilter"
          placeholder="Team name"
          value={teamCreateName}
          onChange={(e) => setTeamCreateName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const name = String(teamCreateName || '').trim();
              if (!name) { setTeamCreateOpen(false); return; }
              Meteor.call('teams.insert', { name }, () => setTeamCreateOpen(false));
            }
          }}
        />
      </Modal>

      <Modal
        open={!!teamDeleteId}
        onClose={() => setTeamDeleteId(null)}
        title="Delete team"
        actions={[
          <button key="cancel" className="btn" onClick={() => setTeamDeleteId(null)}>Cancel</button>,
          <button key="delete" className="btn ml8" onClick={() => {
            const id = teamDeleteId; setTeamDeleteId(null); if (!id) return;
            Meteor.call('teams.remove', id);
          }}>Delete</button>
        ]}
      >
        <p>Are you sure you want to delete this team?</p>
      </Modal>

      <Modal
        open={!!personDeleteId}
        onClose={() => setPersonDeleteId(null)}
        title="Delete person"
        actions={[
          <button key="cancel" className="btn" onClick={() => setPersonDeleteId(null)}>Cancel</button>,
          <button key="delete" className="btn ml8" onClick={() => {
            const id = personDeleteId; setPersonDeleteId(null); if (!id) return;
            Meteor.call('people.remove', id);
          }}>Delete</button>
        ]}
      >
        <p>Delete this person? This action cannot be undone.</p>
      </Modal>
      <PeopleFilterBar
        onNewPerson={() => {
          Meteor.call('people.insert', { name: 'New Person' }, (err, res) => {
            if (!err && res) setHighlightId(res);
          });
        }}
        filter={filter}
        onFilterChange={setFilter}
        teamFilter={teamFilter}
        onTeamFilterChange={setTeamFilter}
        teams={teams}
        count={sorted.length}
      />
      <PeopleTable
        people={sorted}
        teams={teams}
        onUpdate={(id, fields) => { Meteor.call('people.update', id, fields); setHighlightId(id); }}
        onToggleLeft={(id, next) => { Meteor.call('people.update', id, { left: next }); setHighlightId(id); }}
        onDelete={(id) => setPersonDeleteId(id)}
        highlightId={highlightId}
      />
      <h3 className="notesTitle">Notes</h3>
      <table className="peopleTable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={`notes-${p._id}`} className={`${p._id === highlightId ? 'highlight' : ''} ${p.left ? 'leftRow' : ''}`}>
              <td>{[p.name || '', p.lastName || ''].filter(Boolean).join(' ')}</td>
              <td>
                <InlineEditable
                  value={p.notes || ''}
                  placeholder="General notes about this person"
                  as="textarea"
                  rows={4}
                  onSubmit={(v) => { Meteor.call('people.update', p._id, { notes: v }); setHighlightId(p._id); }}
                  fullWidth
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};



