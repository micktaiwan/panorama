import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import './AgentTeams.css';

const POLL_ACTIVE = 5000;
const POLL_IDLE = 15000;

const taskStatusToUi = (status) => {
  if (status === 'in_progress' || status === 'doing') return 'running';
  if (status === 'completed' || status === 'done') return 'completed';
  return 'idle';
};

const teamStatus = (tasks) => {
  if (tasks.some(t => t.status === 'in_progress' || t.status === 'doing')) return 'running';
  if (tasks.length > 0 && tasks.every(t => t.status === 'completed' || t.status === 'done')) return 'completed';
  return 'idle';
};

export const AgentTeams = () => {
  const [teams, setTeams] = useState([]);
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('claude-teams-expanded') === 'true'; } catch { return false; }
  });
  const [expandedTeams, setExpandedTeams] = useState(new Set());
  const hasTeams = teams.length > 0;
  const intervalRef = useRef(null);

  const fetchTeams = useCallback(() => {
    Meteor.call('claudeTeams.getState', (err, result) => {
      if (!err && result) {
        setTeams(result.teams);
        if (result.teams.length > 0 && !expanded) {
          setExpanded(true);
          try { localStorage.setItem('claude-teams-expanded', 'true'); } catch {}
        }
      }
    });
  }, [expanded]);

  useEffect(() => {
    fetchTeams();
    const interval = hasTeams ? POLL_ACTIVE : POLL_IDLE;
    intervalRef.current = setInterval(fetchTeams, interval);
    return () => clearInterval(intervalRef.current);
  }, [hasTeams, fetchTeams]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem('claude-teams-expanded', String(next)); } catch {}
    if (next) fetchTeams();
  };

  const toggleTeam = (teamName) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamName)) next.delete(teamName);
      else next.add(teamName);
      return next;
    });
  };

  return (
    <div className="ccTeamsSection">
      <div className="ccTeamsHeader" onClick={toggleExpanded}>
        <button className={`ccChevron ${expanded ? 'ccChevronOpen' : ''}`}>&#9656;</button>
        <span className="ccTeamsTitle">Teams</span>
        {hasTeams && <span className="ccTeamsBadge">{teams.length}</span>}
      </div>

      {expanded && (
        <div className="ccTeamsList">
          {!hasTeams && <p className="muted ccNoTeams">No active teams</p>}
          {teams.map(team => (
            <TeamItem
              key={team.name}
              team={team}
              isExpanded={expandedTeams.has(team.name)}
              onToggle={() => toggleTeam(team.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TeamItem = ({ team, isExpanded, onToggle }) => {
  const completed = team.tasks.filter(t => t.status === 'completed' || t.status === 'done').length;
  const total = team.tasks.length;
  const status = teamStatus(team.tasks);

  return (
    <div className="ccTeamItem">
      <div className="ccTeamItemTop" onClick={onToggle}>
        <button className={`ccChevron ${isExpanded ? 'ccChevronOpen' : ''}`}>&#9656;</button>
        <span className={`ccStatusDot ccStatusDot--small ccStatus-${status}`} />
        <span className="ccTeamName">{team.name}</span>
        <span className="ccTeamMeta muted">
          {team.members.length} agent{team.members.length !== 1 ? 's' : ''}
          {total > 0 && ` \u00b7 ${completed}/${total}`}
        </span>
      </div>

      {isExpanded && (
        <div className="ccTeamDetails">
          <div className="ccTeamMembers">
            {team.members.map(m => (
              <div key={m.name || m.agentId} className="ccTeamMember">
                <span className="ccTeamMemberIcon">A</span>
                <span className="ccTeamMemberName">{m.name}</span>
                {m.agentType && <span className="ccTeamMemberType muted">{m.agentType}</span>}
              </div>
            ))}
          </div>

          {total > 0 && (
            <div className="ccTeamTasks">
              {team.tasks.map(task => (
                <div key={task.id} className="ccTeamTask">
                  <span className={`ccStatusDot ccStatusDot--small ccStatus-${taskStatusToUi(task.status)}`} />
                  <span className="ccTeamTaskSubject" title={task.description}>{task.subject}</span>
                  {task.status === 'in_progress' && task.activeForm && (
                    <span className="ccTeamTaskActive muted">{task.activeForm}</span>
                  )}
                  {task.owner && <span className="ccTeamTaskOwner muted">{task.owner}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
