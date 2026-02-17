import React from 'react';
import './TeamFilters.css';

// Tri-state team filters: 1 include, -1 exclude, undefined neutral
export const TeamFilters = ({ teams = ['lemapp','sre','data','pony','cto'], storageKey = 'budget_team_filters', onChange }) => {
  const [filters, setFilters] = React.useState(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try { return JSON.parse(raw) || {}; } catch (e) { console.error('Failed to parse', storageKey, e); }
      }
    }
    return {};
  });

  const toggle = (team) => {
    setFilters(prev => {
      const next = { ...prev };
      const cur = next[team];
      if (cur === 1) next[team] = -1; // include -> exclude
      else if (cur === -1) delete next[team]; // exclude -> neutral
      else next[team] = 1; // neutral -> include
      return next;
    });
  };

  React.useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(storageKey, JSON.stringify(filters)); } catch (e) { console.error('Failed to save', storageKey, e); }
    }
    if (typeof onChange === 'function') onChange(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), storageKey]);

  return (
    <div className="teamFilterBar">
      {teams.map((t) => {
        const key = String(t).toLowerCase();
        const state = filters[key];
        const cls = state === 1 ? ' include' : state === -1 ? ' exclude' : '';
        return (
          <button
            key={key}
            className={`teamChip${cls}`}
            onClick={() => toggle(key)}
            title={`${key.toUpperCase()} — ${state === 1 ? 'Included' : state === -1 ? 'Excluded' : 'Neutral'}`}
          >
            {key.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
};

export default TeamFilters;


