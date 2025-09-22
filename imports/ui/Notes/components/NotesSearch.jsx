import React from 'react';
import PropTypes from 'prop-types';
import './NotesSearch.css';

export const NotesSearch = ({ searchTerm, onSearchChange }) => {
  return (
    <div className="notes-search">
      <input
        type="text"
        placeholder="Search for a note..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="search-input"
      />
    </div>
  );
};

NotesSearch.propTypes = {
  searchTerm: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
};
