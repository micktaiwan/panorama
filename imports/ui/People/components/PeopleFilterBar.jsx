import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';
import { PeopleExportModal } from '/imports/ui/People/components/PeopleExportModal.jsx';
import { PeopleHrSyncModal } from '/imports/ui/People/components/PeopleHrSyncModal.jsx';

export const PeopleFilterBar = ({ onNewPerson, filter, onFilterChange, teamFilter, onTeamFilterChange, subteamFilter, onSubteamFilterChange, teams, count = 0, onCopy, people }) => {
  const [exportOpen, setExportOpen] = useState(false);
  const [hrPreview, setHrPreview] = useState(null);
  const [hrBusy, setHrBusy] = useState(false);

  // Dry run first, always. The button shows what would change; a second click
  // in the modal is what actually changes it.
  const previewHrSync = () => {
    setHrBusy(true);
    Meteor.call('people.syncFromHrTech', { dryRun: true }, (err, res) => {
      setHrBusy(false);
      if (err) {
        notify({ message: `HR sync failed: ${err.message}`, kind: 'error' });
        return;
      }
      setHrPreview(res);
    });
  };

  return (
    <div className="peopleToolbar">
      <button className="btn btn-primary" onClick={onNewPerson}>New person</button>
      <input className="peopleFilter" placeholder="Filter…" value={filter} onChange={(e) => onFilterChange(e.target.value)} />
      <select className="peopleFilter" value={teamFilter} onChange={(e) => onTeamFilterChange(e.target.value)}>
        <option value="">All teams</option>
        <option value="__none__">No team</option>
        {(teams || [])
          .filter(t => {
            const nm = String(t.name || '').toLowerCase();
            return nm !== 'sre/devops' && nm !== 'data';
          })
          .map(t => (
            <option key={t._id} value={t._id}>{t.name || ''}</option>
          ))}
      </select>
      <select className="peopleFilter" value={subteamFilter} onChange={(e) => onSubteamFilterChange(e.target.value)}>
        <option value="">All subteams</option>
        <option value="sre">SRE</option>
        <option value="devops">DevOps</option>
        <option value="data">Data</option>
      </select>
      <span className="ml8" aria-live="polite">{count} shown</span>
      <button className="btn ml8" onClick={onCopy}>Copy</button>
      <button className="btn ml8" onClick={() => setExportOpen(true)}>Export…</button>
      {/* Replaced the Google Workspace JSON import: the roster now comes from
          the SIRH through HR Tech, with no file to download by hand and no
          confusion between "the account is active" and "the person works
          here". */}
      <button className="btn ml8" disabled={hrBusy} onClick={previewHrSync}>
        {hrBusy ? 'Checking HR…' : 'Sync from HR'}
      </button>
      <PeopleExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        people={people}
        teams={teams}
      />
      <PeopleHrSyncModal preview={hrPreview} onClose={() => setHrPreview(null)} />
    </div>
  );
};


PeopleFilterBar.propTypes = {
  onNewPerson: PropTypes.func,
  filter: PropTypes.string,
  onFilterChange: PropTypes.func,
  teamFilter: PropTypes.string,
  onTeamFilterChange: PropTypes.func,
  subteamFilter: PropTypes.string,
  onSubteamFilterChange: PropTypes.func,
  teams: PropTypes.array,
  count: PropTypes.number,
  onCopy: PropTypes.func,
  people: PropTypes.array,
};
