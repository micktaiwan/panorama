import React from 'react';
import PropTypes from 'prop-types';
import { navigateTo } from '/imports/ui/router';
import './ReleasesDropdown.css';

export const ReleasesDropdown = ({ releases, lastSeen, onClose }) => {
  const handleClick = (releaseId) => {
    navigateTo({ name: 'releases', releaseId });
    onClose();
  };

  return (
    <div className="releasesDropdown">
      <div className="releasesDropdown-header">
        <strong>Releases</strong>
        <button
          className="btn-link"
          onClick={() => { navigateTo({ name: 'releases' }); onClose(); }}
        >
          View all
        </button>
      </div>
      {releases.length === 0 ? (
        <div className="releasesDropdown-empty">No releases yet</div>
      ) : (
        <ul className="releasesDropdown-list">
          {releases.map((r) => {
            const isUnread = !lastSeen || r.createdAt > lastSeen;
            return (
              <li key={r._id} className={`releasesDropdown-item${isUnread ? ' unread' : ''}`}>
                <button className="releasesDropdown-itemBtn" onClick={() => handleClick(r._id)}>
                  <span className="releasesDropdown-version">v{r.version}</span>
                  <span className="releasesDropdown-title">{r.title}</span>
                  <span className="releasesDropdown-date">
                    {r.createdAt?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

ReleasesDropdown.propTypes = {
  releases: PropTypes.array.isRequired,
  lastSeen: PropTypes.instanceOf(Date),
  onClose: PropTypes.func.isRequired,
};
