import React from 'react';
import PropTypes from 'prop-types';
import './NotesSearch.css';

export const NotesSearch = ({
  searchTerm, onSearchChange, showOnlyOpen, onShowOnlyOpenChange,
  noteCount = 0, matchCount = 0, currentMatch = -1, onPrevMatch, onNextMatch,
}) => {
  const showNav = searchTerm.length >= 3 && matchCount > 0;

  return (
    <div className="notes-search">
      <input
        type="text"
        placeholder="Search for a note..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="search-input"
      />

      {searchTerm && (
        <div className="notes-search-nav">
          <span className="notes-search-note-count">
            {noteCount} note{noteCount !== 1 ? 's' : ''}
          </span>
          {showNav && (
            <>
              <span className="notes-search-nav-sep" />
              <span className="notes-search-nav-count">
                {currentMatch + 1} of {matchCount}
              </span>
              <button
                type="button"
                className="notes-search-nav-btn"
                onClick={onPrevMatch}
                title="Previous match"
              >
                &#9650;
              </button>
              <button
                type="button"
                className="notes-search-nav-btn"
                onClick={onNextMatch}
                title="Next match"
              >
                &#9660;
              </button>
            </>
          )}
        </div>
      )}

      <label className="show-only-open-checkbox">
        <input
          type="checkbox"
          checked={showOnlyOpen}
          onChange={(e) => onShowOnlyOpenChange(e.target.checked)}
        />
        <span>Display only open</span>
      </label>
    </div>
  );
};

NotesSearch.propTypes = {
  searchTerm: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  showOnlyOpen: PropTypes.bool.isRequired,
  onShowOnlyOpenChange: PropTypes.func.isRequired,
  noteCount: PropTypes.number,
  matchCount: PropTypes.number,
  currentMatch: PropTypes.number,
  onPrevMatch: PropTypes.func,
  onNextMatch: PropTypes.func,
};
