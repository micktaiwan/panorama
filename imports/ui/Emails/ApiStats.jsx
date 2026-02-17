import React from 'react';
import PropTypes from 'prop-types';
import { Card } from '../components/Card/Card.jsx';

export const ApiStats = ({ apiStats, emailStats, threadsCount: _threadsCount, ctaStats, onRefreshStats, onCleanupDuplicates }) => {
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
            <span className={`statValue ${(emailStats?.errorMessages || 0) > 0 ? 'statValue--error' : 'statValue--success'}`}>
              {emailStats?.errorMessages || 0}
            </span>
          </div>
        </div>
        
        {/* CTA Statistics */}
        {ctaStats && (
          <div className="apiStats-ctaSection">
            <h4>CTA Suggestions</h4>
            <div className="statsGrid">
              <div className="statItem">
                <span className="statLabel">Prepared Emails:</span>
                <span className="statValue">{ctaStats.preparedCount}</span>
              </div>
              <div className="statItem">
                <span className="statLabel">Preparing:</span>
                <span className="statValue">{ctaStats.preparingCount}</span>
              </div>
              <div className="statItem">
                <span className="statLabel">Total Eligible:</span>
                <span className="statValue">{ctaStats.totalEligibleCount}</span>
              </div>
              <div className="statItem">
                <span className="statLabel">Actions Taken:</span>
                <span className="statValue">{ctaStats.totalActions}</span>
              </div>
              <div className="statItem">
                <span className="statLabel">Acceptance Rate:</span>
                <span className={`statValue ${ctaStats.acceptanceRate >= 70 ? 'statValue--success' : ctaStats.acceptanceRate >= 50 ? 'statValue--warning' : 'statValue--error'}`}>
                  {ctaStats.acceptanceRate}%
                </span>
              </div>
            </div>
            
            {/* Action breakdown */}
            {ctaStats.actionCounts && Object.keys(ctaStats.actionCounts).length > 0 && (
              <div className="apiStats-breakdown">
                <h5>Actions Taken:</h5>
                <div className="apiStats-tags">
                  {Object.entries(ctaStats.actionCounts).map(([action, count]) => (
                    <span key={action} className="apiStats-tag">
                      {action}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Suggestion breakdown */}
            {ctaStats.suggestionCounts && Object.keys(ctaStats.suggestionCounts).length > 0 && (
              <div className="apiStats-breakdown">
                <h5>Suggestions Made:</h5>
                <div className="apiStats-tags">
                  {Object.entries(ctaStats.suggestionCounts).map(([action, count]) => (
                    <span key={action} className="apiStats-tag">
                      {action}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {(emailStats?.errorMessages || 0) > 0 && (
          <div className="apiStats-warning">
            ⚠️ {emailStats.errorMessages} message{emailStats.errorMessages > 1 ? 's' : ''} failed to load completely. Check console for details.
          </div>
        )}
        <div className="apiStats-actions">
          <button 
            className="btn btn-sm" 
            onClick={onRefreshStats}
          >
            Refresh Stats
          </button>
          <button 
            className="btn btn-sm apiStats-cleanupButton" 
            onClick={onCleanupDuplicates}
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
  ctaStats: PropTypes.shape({
    preparedCount: PropTypes.number,
    preparingCount: PropTypes.number,
    totalEligibleCount: PropTypes.number,
    totalActions: PropTypes.number,
    acceptedActions: PropTypes.number,
    acceptanceRate: PropTypes.number,
    actionCounts: PropTypes.object,
    suggestionCounts: PropTypes.object
  }),
  onRefreshStats: PropTypes.func.isRequired,
  onCleanupDuplicates: PropTypes.func.isRequired
};
