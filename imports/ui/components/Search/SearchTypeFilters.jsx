import React from 'react';
import PropTypes from 'prop-types';

// Tri-state type filters for search results
// State values: 1 include, -1 exclude, undefined neutral
export const SearchTypeFilters = ({
  storageKey = 'search_type_filters_v1',
  value,
  onChange,
  counts = {}, // { project: n, task: n, ... }
}) => {
  const TYPES = React.useMemo(() => ([
    { key: 'project', label: 'Projects' },
    { key: 'task', label: 'Tasks' },
    { key: 'note', label: 'Notes' },
    { key: 'link', label: 'Links' },
    { key: 'file', label: 'Files' },
    { key: 'session', label: 'Sessions' },
    { key: 'userlog', label: 'Logs' },
  ]), []);

  const [filters, setFilters] = React.useState(() => {
    if (value && typeof value === 'object') return value;
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) || {};
    }
    return {};
  });

  const toggle = (key) => {
    setFilters(prev => {
      const next = { ...prev };
      const cur = next[key];
      if (cur === 1) next[key] = -1; // include -> exclude
      else if (cur === -1) delete next[key]; // exclude -> neutral
      else next[key] = 1; // neutral -> include
      return next;
    });
  };

  React.useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(filters));
    if (typeof onChange === 'function') onChange(filters);
  }, [JSON.stringify(filters), storageKey]);

  return (
    <div className="typeFilterBar">
      {TYPES.map(t => {
        const state = filters[t.key];
        const cls = state === 1 ? ' include' : state === -1 ? ' exclude' : '';
        const c = Number(counts[t.key]) || 0;
        return (
          <button
            key={t.key}
            className={`typeChip${cls}${c === 0 ? ' empty' : ''}`}
            onClick={() => toggle(t.key)}
            aria-pressed={state === 1}
            aria-label={`${t.label} filter: ${state === 1 ? 'include' : state === -1 ? 'exclude' : 'neutral'}`}
          >
            <span className="label">{t.label}</span>
            {Number.isFinite(c) ? (<span className="badge">{c}</span>) : null}
          </button>
        );
      })}
      {Object.keys(filters).length > 0 ? (
        <button className="typeChip reset" onClick={() => setFilters({})}>Reset</button>
      ) : null}
    </div>
  );
};

SearchTypeFilters.propTypes = {
  storageKey: PropTypes.string,
  value: PropTypes.object,
  onChange: PropTypes.func,
  counts: PropTypes.object,
};



