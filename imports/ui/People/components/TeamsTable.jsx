import React from 'react';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';

export const TeamsTable = ({ teams, teamCounts, onNewTeamClick, onDeleteTeam, onRenameTeam }) => {
  return (
    <>
      <div className="peopleToolbar" style={{ marginBottom: 8 }}>
        <strong>Teams</strong>
        <button className="btn ml8" onClick={onNewTeamClick}>New team</button>
      </div>
      <table className="peopleTable" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th className="actionsCol">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(teams || []).map(t => (
            <tr key={t._id}>
              <td>
                <InlineEditable value={t.name || ''} placeholder="team name" onSubmit={(v) => onRenameTeam(t._id, v)} fullWidth />
              </td>
              <td>{teamCounts.get(t._id) || 0}</td>
              <td className="actionsCol"><button className="btn" onClick={() => onDeleteTeam(t._id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};


