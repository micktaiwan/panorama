import React from 'react';
import PropTypes from 'prop-types';
import { ClearableInput } from '/imports/ui/components/ClearableInput/ClearableInput.jsx';

export const EmailsToolbar = ({ 
  searchQuery, 
  setSearchQuery, 
  searchFromGmail, 
  setSearchFromGmail, 
  onSearch, 
  onRefresh, 
  isRefreshing, 
  onSyncLabels,
  isSyncingLabels,
  onToggleApiStats,
  showApiStats: _showApiStats,
  onNavigateToInboxZero
}) => {
  return (
    <div className="emailsToolbar">
      <form onSubmit={onSearch} className="searchForm">
        <ClearableInput
          fill
          type="text"
          placeholder="Search emails..."
          value={searchQuery}
          onChange={setSearchQuery}
          className="searchInput"
        />
        <button type="submit" className="btn">
          {searchFromGmail ? 'Search Gmail API' : 'Search DB'}
        </button>
      </form>
      <div className="searchOptions">
        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={searchFromGmail}
            onChange={(e) => setSearchFromGmail(e.target.checked)}
          />
          <span>Search via Gmail API</span>
        </label>
      </div>
      <button 
        className="btn" 
        onClick={onRefresh}
        disabled={isRefreshing}
        title="Refresh emails"
      >
        {isRefreshing ? '⏳ Refreshing...' : '↻ Refresh'}
      </button>
      <button 
        className="btn" 
        onClick={onSyncLabels}
        disabled={isSyncingLabels}
        title="Synchronize labels with Gmail"
      >
        {isSyncingLabels ? '⏳ Syncing...' : '🏷️ Sync Labels'}
      </button>
      <button 
        className="btn" 
        onClick={onToggleApiStats}
        title="Toggle API statistics"
      >
        📊 API Stats
      </button>
      <button 
        className="btn btn-primary" 
        onClick={onNavigateToInboxZero}
        title="Open Inbox Zero mode"
      >
        🎯 Inbox Zero
      </button>
    </div>
  );
};

EmailsToolbar.propTypes = {
  searchQuery: PropTypes.string.isRequired,
  setSearchQuery: PropTypes.func.isRequired,
  searchFromGmail: PropTypes.bool.isRequired,
  setSearchFromGmail: PropTypes.func.isRequired,
  onSearch: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  isRefreshing: PropTypes.bool.isRequired,
  onSyncLabels: PropTypes.func.isRequired,
  isSyncingLabels: PropTypes.bool.isRequired,
  onToggleApiStats: PropTypes.func.isRequired,
  showApiStats: PropTypes.bool.isRequired,
  onNavigateToInboxZero: PropTypes.func.isRequired
};
