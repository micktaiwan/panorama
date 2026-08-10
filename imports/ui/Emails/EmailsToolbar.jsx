import React from 'react';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
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
      <Tooltip content="Refresh emails">
        <button
          className="btn"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? '⏳ Refreshing...' : '↻ Refresh'}
        </button>
      </Tooltip>
      <Tooltip content="Synchronize labels with Gmail">
        <button
          className="btn"
          onClick={onSyncLabels}
          disabled={isSyncingLabels}
        >
          {isSyncingLabels ? '⏳ Syncing...' : '🏷️ Sync Labels'}
        </button>
      </Tooltip>
      <Tooltip content="Toggle API statistics">
        <button
          className="btn"
          onClick={onToggleApiStats}
        >
          📊 API Stats
        </button>
      </Tooltip>
      <Tooltip content="Open Inbox Zero mode">
        <button
          className="btn btn-primary"
          onClick={onNavigateToInboxZero}
        >
          🎯 Inbox Zero
        </button>
      </Tooltip>
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
