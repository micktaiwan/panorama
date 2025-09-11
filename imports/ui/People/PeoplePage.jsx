import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
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
import { loadPeopleFilters, savePeopleTeamFilter, savePeopleTextFilter, savePeopleSubteamFilter } from '/imports/ui/People/filters.js';
import { useRowHighlight } from '/imports/ui/hooks/useRowHighlight.js';
import { useHashHighlight } from '/imports/ui/hooks/useHashHighlight.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
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
  const [subteamFilter, setSubteamFilter] = useState(() => loadPeopleFilters().subteam);
  const deepLinkId = useHashHighlight('people', '#/people');
  const [highlightId, setHighlightId] = useState(deepLinkId || null);
  useEffect(() => {
    if (externalHighlightId) setHighlightId(externalHighlightId);
  }, [externalHighlightId]);
  useRowHighlight(highlightId, '.peopleTable tbody tr', () => setHighlightId(null));
  const normalize = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  useEffect(() => { savePeopleTextFilter(filter || ''); }, [filter]);
  useEffect(() => { savePeopleTeamFilter(teamFilter || ''); }, [teamFilter]);
  useEffect(() => { savePeopleSubteamFilter(subteamFilter || ''); }, [subteamFilter]);
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
    let afterTeam = base;
    if (teamFilter) {
      if (teamFilter === '__none__') {
        afterTeam = base.filter(p => !p.teamId);
      } else {
        // Merge Tech with SRE/DevOps and Data
        const teamIdToName = new Map((teams || []).map(t => [String(t._id), String(t.name || '').toLowerCase()]));
        const selectedName = teamIdToName.get(String(teamFilter));
        const techGroup = new Set(['tech', 'sre/devops', 'data']);
        if (selectedName && selectedName === 'tech') {
          afterTeam = base.filter(p => techGroup.has(teamIdToName.get(String(p.teamId || '')) || ''));
        } else {
          afterTeam = base.filter(p => String(p.teamId || '') === teamFilter);
        }
      }
    }
    if (subteamFilter) {
      const sub = String(subteamFilter).toLowerCase();
      const teamIdToName = new Map((teams || []).map(t => [String(t._id), String(t.name || '').toLowerCase()]));
      return afterTeam.filter(p => {
        const personSub = String(p.subteam || '').toLowerCase();
        if (personSub) return personSub === sub;
        const teamName = teamIdToName.get(String(p.teamId || '')) || '';
        if (sub === 'data') return teamName === 'data';
        if (sub === 'sre' || sub === 'devops') return teamName === 'sre/devops';
        return false;
      });
    }
    return afterTeam;
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
      p.teamId,
      p.arrivalDate,
      p.subteam
    ])),
    filter,
    teamFilter,
    subteamFilter,
    JSON.stringify((teams || []).map(t => [t._id, t.name]))
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
    p.notes,
    p.arrivalDate,
    p.subteam
  ]))]);
  const handleCopy = async () => {
    const teamNameById = new Map((teams || []).map(t => [String(t._id), t.name || '']));
    const header = 'First name\tLast name\tRole\tTeam\tEmail\tAliases\tArrival\tLeft';
    const lines = (sorted || []).map(p => {
      const teamName = p.teamId ? (teamNameById.get(String(p.teamId)) || '') : '';
      const aliases = Array.isArray(p.aliases) ? p.aliases.join(', ') : '';
      const arrival = p.arrivalDate ? new Date(p.arrivalDate).toISOString().slice(0,10) : '';
      const left = p.left ? 'yes' : '';
      return `${p.name || ''}\t${p.lastName || ''}\t${p.role || ''}\t${teamName}\t${p.email || ''}\t${aliases}\t${arrival}\t${left}`;
    });
    const text = [header, ...lines].join('\n');
    await writeClipboard(text);
  };
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
        subteamFilter={subteamFilter}
        onSubteamFilterChange={setSubteamFilter}
        teams={teams}
        count={sorted.length}
        onCopy={handleCopy}
      />
      <div className="tableMeta">Displayed: {sorted.length}</div>
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



PeoplePage.propTypes = {
  highlightId: PropTypes.string,
};

