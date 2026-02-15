import React, { useState, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ReleasesCollection } from '/imports/api/releases/collections';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { ReleasesDropdown } from './ReleasesDropdown.jsx';
import './NotificationBell.css';

export const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useSubscribe('releases.all');
  const releases = useFind(() => ReleasesCollection.find({}, { sort: { createdAt: -1 } }));
  const userPrefs = useFind(() => UserPreferencesCollection.find({}, { limit: 1 }))[0];

  const lastSeen = userPrefs?.lastSeenReleaseAt;
  const unreadCount = releases.filter(r => !lastSeen || r.createdAt > lastSeen).length;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      Meteor.call('userPreferences.markReleasesSeen');
    }
  };

  return (
    <span className="notificationBell" ref={ref}>
      <button className="notificationBell-btn" onClick={handleToggle} title="Release notes">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="notificationBell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <ReleasesDropdown
          releases={releases.slice(0, 10)}
          lastSeen={lastSeen}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
};
