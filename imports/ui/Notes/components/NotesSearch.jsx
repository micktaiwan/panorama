import React from 'react';
import PropTypes from 'prop-types';
import './NotesSearch.css';

export const NotesSearch = ({ searchTerm, onSearchChange, showOnlyOpen, onShowOnlyOpenChange }) => {
  return (
    <div className="notes-search">
      <input
        type="text"
        placeholder="Search for a note..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="search-input"
      />

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
};
