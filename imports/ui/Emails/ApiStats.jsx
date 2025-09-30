import React from 'react';
import PropTypes from 'prop-types';
import { Card } from '../components/Card/Card.jsx';

export const ApiStats = ({ apiStats, emailStats, threadsCount, onRefreshStats, onCleanupDuplicates }) => {
  if (!apiStats) return null;

  return (
    <Card>
      <div className="apiStats">
        <h3>Gmail API Statistics</h3>
        <div className="statsGrid">
          <div className="statItem">
            <span className="statLabel">Total API Calls:</span>
            <span className="statValue">{apiStats.totalApiCalls}</span>
          </div>
          <div className="statItem">
            <span className="statLabel">Last Updated:</span>
            <span className="statValue">{new Date(apiStats.timestamp).toLocaleString()}</span>
          </div>
          <div className="statItem">
            <span className="statLabel">Messages in DB:</span>
            <span className="statValue">{emailStats?.totalMessages || 0}</span>
          </div>
          <div className="statItem">
            <span className="statLabel">Inbox Messages:</span>
            <span className="statValue">{emailStats?.inboxMessages || 0}</span>
          </div>
          <div className="statItem">
            <span className="statLabel">Threads:</span>
            <span className="statValue">{emailStats?.threads || 0}</span>
          </div>
          <div className="statItem">
            <span className="statLabel">Messages with Errors:</span>
            <span className="statValue" style={{ color: (emailStats?.errorMessages || 0) > 0 ? '#ff6b6b' : '#4ecdc4' }}>
              {emailStats?.errorMessages || 0}
            </span>
          </div>
        </div>
        {(emailStats?.errorMessages || 0) > 0 && (
          <div style={{ 
            marginTop: '12px', 
            padding: '8px 12px', 
            background: '#fff3cd', 
            border: '1px solid #ffeaa7', 
            borderRadius: '4px',
            fontSize: '13px',
            color: '#856404'
          }}>
            ⚠️ {emailStats.errorMessages} message{emailStats.errorMessages > 1 ? 's' : ''} failed to load completely. Check console for details.
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button 
            className="btn btn-sm" 
            onClick={onRefreshStats}
          >
            Refresh Stats
          </button>
          <button 
            className="btn btn-sm" 
            onClick={onCleanupDuplicates}
            style={{ background: '#ff6b6b', color: 'white' }}
          >
            Clean Duplicates
          </button>
        </div>
      </div>
    </Card>
  );
};

ApiStats.propTypes = {
  apiStats: PropTypes.shape({
    totalApiCalls: PropTypes.number,
    timestamp: PropTypes.string
  }),
  emailStats: PropTypes.shape({
    totalMessages: PropTypes.number,
    inboxMessages: PropTypes.number,
    threads: PropTypes.number,
    errorMessages: PropTypes.number,
    timestamp: PropTypes.string
  }),
  threadsCount: PropTypes.number.isRequired,
  onRefreshStats: PropTypes.func.isRequired,
  onCleanupDuplicates: PropTypes.func.isRequired
};
