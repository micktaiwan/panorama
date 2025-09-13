import React from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';

export const PeopleFilterBar = ({ onNewPerson, filter, onFilterChange, teamFilter, onTeamFilterChange, subteamFilter, onSubteamFilterChange, teams, count = 0, onCopy }) => {
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
      <label className="btn ml8">
        Import JSON
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try {
              const text = await file.text();
              const data = JSON.parse(text);
              const records = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
              if (!Array.isArray(records) || records.length === 0) {
                notify({ message: 'No records found in JSON', kind: 'warning' });
                return;
              }
              Meteor.call('people.importGoogleWorkspace', records, (err, res) => {
                if (err) {
                  notify({ message: `Import failed: ${err.message}`, kind: 'error' });
                } else {
                  const { inserted = 0, updated = 0, skipped = 0 } = res || {};
                  notify({ message: `Import done. Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`, kind: 'info' });
                }
              });
            } catch (err) {
              notify({ message: `Invalid JSON: ${err.message}`, kind: 'error' });
            }
          }}
        />
      </label>
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
};

