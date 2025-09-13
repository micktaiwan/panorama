import React from 'react';

import './Search.css';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';

export const SearchBar = ({ value, onChange, onSearch, resultsCount = 0, placeholder = 'Search (semantic)…', autoFocus = false, cached = false, armSelectFirst = false, onSelectFirst = null, cacheSize = 0, loading = false, onEscape = null }) => {
  return (
    <div className="searchSection">
      <input
        className="afInput searchInput"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (armSelectFirst && resultsCount > 0 && typeof onSelectFirst === 'function') {
              e.preventDefault();
              onSelectFirst();
            } else {
              const query = e.currentTarget.value;
              onSearch(typeof query === 'string' ? query : '');
            }
          } else if (e.key === 'Escape') {
            const current = String(e.currentTarget.value || '');
            if (current.length > 0) {
              e.preventDefault();
              if (typeof e.stopPropagation === 'function') e.stopPropagation();
              onChange('');
            } else if (typeof onEscape === 'function') {
              e.preventDefault();
              if (typeof e.stopPropagation === 'function') e.stopPropagation();
              onEscape();
            }
          }
        }}
      />
      {(resultsCount > 0 || loading) ? (
        <div className="searchMeta">
          {resultsCount > 0 ? (
            <>
              Results: {resultsCount}
              {cached ? (
                <Tooltip content={`Vecteur en cache · Cache size: ${cacheSize}`}>
                  <span className="cachedDot">●</span>
                </Tooltip>
              ) : (
                <Tooltip content={`Vecteur recalculé · Cache size: ${cacheSize}`}>
                  <span className="uncachedDot">●</span>
                </Tooltip>
              )}
            </>
          ) : null}
          {loading ? (
            <Tooltip content="Recherche en cours…">
              <span className="searchSpinner" aria-live="polite" aria-busy="true" aria-label="Loading" />
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};


