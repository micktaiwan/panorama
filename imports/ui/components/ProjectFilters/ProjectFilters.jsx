import React from 'react';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import './ProjectFilters.css';

// Tri-state project filters: 1 include, -1 exclude, undefined neutral
export const ProjectFilters = ({ projects, storageKey = 'dashboard_proj_filters', onChange }) => {
  const [filters, setFilters] = React.useState(() => {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try { return JSON.parse(raw) || {}; } catch (e) { console.error('Failed to parse', storageKey, e); }
      }
    }
    return {};
  });

  const projectsForFilter = React.useMemo(() => {
    const list = [...(projects || [])];
    list.sort((a, b) => {
      const af = a.isFavorite ? 0 : 1;
      const bf = b.isFavorite ? 0 : 1;
      if (af !== bf) return af - bf;
      const ar = Number.isFinite(a.favoriteRank) ? a.favoriteRank : Number.POSITIVE_INFINITY;
      const br = Number.isFinite(b.favoriteRank) ? b.favoriteRank : Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      return an.localeCompare(bn);
    });
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((projects || []).map(p => [p._id, !!p.isFavorite, p.favoriteRank || 0, p.name || ''].join(':')))]);

  const toggle = (projectId) => {
    setFilters(prev => {
      const next = { ...prev };
      const cur = next[projectId];
      if (cur === 1) next[projectId] = -1; // include -> exclude
      else if (cur === -1) delete next[projectId]; // exclude -> neutral
      else next[projectId] = 1; // neutral -> include
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
    <div className="projFilterBar">
      {projectsForFilter.map(p => {
        const state = filters[p._id];
        const cls = state === 1 ? ' include' : state === -1 ? ' exclude' : '';
        const fullName = p.name || '(untitled project)';
        const label = fullName.length > 15 ? `${fullName.slice(0, 15)}` : fullName;
        return (
          <Tooltip key={p._id} content={fullName} placement="top">
            <button
              className={`projChip${cls}`}
              onClick={() => toggle(p._id)}
            >
              {label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};


