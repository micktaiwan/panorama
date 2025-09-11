import React from 'react';
import PropTypes from 'prop-types';
import { InlineDate } from '/imports/ui/InlineDate/InlineDate.jsx';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';

export const PeopleTable = ({ people, teams, onUpdate, onToggleLeft, onDelete, highlightId }) => {
  return (
    <table className="peopleTable">
      <thead>
        <tr>
          <th>First name</th>
          <th>Last name</th>
          <th>Role</th>
          <th>Team</th>
          <th>Subteam</th>
          <th>Email</th>
          <th>Aliases</th>
          <th>Arrival</th>
          <th>Left</th>
          <th className="actionsCol">Actions</th>
        </tr>
      </thead>
      <tbody>
        {people.map(p => (
          <tr key={p._id} data-person-id={p._id} className={`${p._id === highlightId ? 'highlight' : ''} ${p.left ? 'leftRow' : ''}`}>
            <td className={!p.name ? 'emptyCell' : ''}>
              <InlineEditable value={p.name || ''} placeholder="first name" onSubmit={(v) => onUpdate(p._id, { name: v })} fullWidth />
            </td>
            <td className={!p.lastName ? 'emptyCell' : ''}>
              <InlineEditable value={p.lastName || ''} placeholder="last name" onSubmit={(v) => onUpdate(p._id, { lastName: v })} fullWidth />
            </td>
            <td className={!p.role ? 'emptyCell' : ''}>
              <InlineEditable value={p.role || ''} placeholder="role" onSubmit={(v) => onUpdate(p._id, { role: v })} fullWidth />
            </td>
            <td>
              {(() => {
                const teamIdToName = new Map((teams || []).map(t => [String(t._id), String(t.name || '').toLowerCase()]));
                const tech = (teams || []).find(t => String(t.name || '').toLowerCase() === 'tech');
                const techTeamId = tech ? String(tech._id) : '';
                const isTechGroup = (id) => {
                  const nm = teamIdToName.get(String(id)) || '';
                  return nm === 'tech' || nm === 'sre/devops' || nm === 'data';
                };
                const value = isTechGroup(p.teamId) && techTeamId ? techTeamId : (p.teamId || '');
                const options = [{ value: '', label: '(no team)' }]
                  .concat((teams || [])
                    .filter(t => {
                      const nm = String(t.name || '').toLowerCase();
                      return nm !== 'sre/devops' && nm !== 'data';
                    })
                    .map(t => ({ value: t._id, label: t.name || '' }))
                  );
                return (
                  <InlineEditable
                    as="select"
                    value={value}
                    options={options}
                    onSubmit={(v) => onUpdate(p._id, { teamId: v || undefined })}
                  />
                );
              })()}
            </td>
            <td>
              <InlineEditable
                as="select"
                value={String(p.subteam || '')}
                options={[
                  { value: '', label: '(no subteam)' },
                  { value: 'sre', label: 'SRE' },
                  { value: 'devops', label: 'DevOps' },
                  { value: 'data', label: 'Data' }
                ]}
                onSubmit={(v) => onUpdate(p._id, { subteam: v || undefined })}
              />
            </td>
            <td className={!p.email ? 'emptyCell' : ''}>
              <InlineEditable value={p.email || ''} placeholder="email" onSubmit={(v) => onUpdate(p._id, { email: v })} fullWidth />
            </td>
            <td className={!(p.aliases && p.aliases.length > 0) ? 'emptyCell' : ''}>
              <InlineEditable
                value={(p.aliases || []).join(', ')}
                placeholder="aliases (comma-separated)"
                onSubmit={(v) => onUpdate(p._id, { aliases: String(v || '').split(',').map(s => s.trim()).filter(Boolean) })}
                fullWidth
              />
            </td>
            <td>
              <InlineDate
                value={p.arrivalDate}
                onSubmit={(v) => onUpdate(p._id, { arrivalDate: v || undefined })}
                placeholder="no date"
              />
            </td>
            <td>
              <input type="checkbox" checked={!!p.left} onChange={() => onToggleLeft(p._id, !p.left)} />
            </td>
            <td className="actionsCol">
              <button className="btn" onClick={() => onDelete(p._id)}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};


PeopleTable.propTypes = {
  people: PropTypes.array.isRequired,
  teams: PropTypes.array,
  onUpdate: PropTypes.func,
  onToggleLeft: PropTypes.func,
  onDelete: PropTypes.func,
  highlightId: PropTypes.string,
};

