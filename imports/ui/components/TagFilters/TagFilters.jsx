import React from 'react';
import PropTypes from 'prop-types';
import './TagFilters.css';

/**
 * Tri-state tag filters: 1 include, -1 exclude, undefined neutral.
 * Tags are global (they are not attached to a project), which is what makes
 * them the way to group tasks by context — "outside", "phone", "home".
 * Several included tags act as OR: a task matching any of them is kept.
 */
export const TagFilters = ({ tags, storageKey = 'dashboard_tag_filters', onChange }) => {
  const [filters, setFilters] = React.useState(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try { return JSON.parse(raw) || {}; } catch (e) { console.error('Failed to parse', storageKey, e); }
      }
    }
    return {};
  });

  const sortedTags = React.useMemo(
    () => [...(tags || [])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    [tags]
  );

  const toggle = (tag) => {
    setFilters(prev => {
      const next = { ...prev };
      const cur = next[tag];
      if (cur === 1) next[tag] = -1; // include -> exclude
      else if (cur === -1) delete next[tag]; // exclude -> neutral
      else next[tag] = 1; // neutral -> include
      return next;
    });
  };

  const clear = () => setFilters({});

  React.useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(storageKey, JSON.stringify(filters)); } catch (e) { console.error('Failed to save', storageKey, e); }
    }
    if (typeof onChange === 'function') onChange(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), storageKey]);

  if (sortedTags.length === 0) return null;

  const hasActive = Object.keys(filters).length > 0;

  return (
    <div className="tagFilterBar">
      {sortedTags.map(tag => {
        const state = filters[tag];
        const cls = state === 1 ? ' include' : state === -1 ? ' exclude' : '';
        return (
          <button
            key={tag}
            type="button"
            className={`tagFilterChip${cls}`}
            onClick={() => toggle(tag)}
            aria-pressed={state === 1}
          >
            #{tag}
          </button>
        );
      })}
      {hasActive ? (
        <button type="button" className="tagFilterClear" onClick={clear}>Clear tags</button>
      ) : null}
    </div>
  );
};

TagFilters.propTypes = {
  tags: PropTypes.arrayOf(PropTypes.string),
  storageKey: PropTypes.string,
  onChange: PropTypes.func,
};

/**
 * Apply a tri-state tag filter map to a list of tasks.
 * Excluded tags win over included ones.
 */
export const applyTagFilters = (tasks, filters) => {
  const include = Object.entries(filters || {}).filter(([, v]) => v === 1).map(([k]) => k.toLowerCase());
  const exclude = Object.entries(filters || {}).filter(([, v]) => v === -1).map(([k]) => k.toLowerCase());
  if (include.length === 0 && exclude.length === 0) return tasks;

  return tasks.filter(task => {
    const taskTags = (Array.isArray(task.tags) ? task.tags : []).map(t => String(t).toLowerCase());
    if (exclude.some(t => taskTags.includes(t))) return false;
    if (include.length > 0) return include.some(t => taskTags.includes(t));
    return true;
  });
};

/** Distinct tags present in a list of tasks, original casing kept. */
export const collectTags = (tasks) => {
  const seen = new Map();
  for (const task of (tasks || [])) {
    for (const raw of (Array.isArray(task.tags) ? task.tags : [])) {
      const tag = String(raw).trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()];
};
