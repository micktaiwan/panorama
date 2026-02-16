import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { navigateTo } from '/imports/ui/router.js';
import './UserMenu.css';

export const UserMenu = () => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const user = useTracker(() => Meteor.user(), []);
  const displayName = user?.profile?.name || user?.emails?.[0]?.address || 'User';

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="userMenu" ref={menuRef}>
      <button className="userMenuTrigger" onClick={() => setOpen((o) => !o)}>
        {displayName}
      </button>
      {open && (
        <div className="userMenuDropdown">
          <a
            href="#/preferences/profile"
            className="userMenuItem"
            onClick={(e) => {
              e.preventDefault();
              navigateTo({ name: 'preferences', tab: 'profile' });
              setOpen(false);
            }}
          >
            Profile
          </a>
          <a
            href="#/preferences"
            className="userMenuItem"
            onClick={(e) => {
              e.preventDefault();
              navigateTo({ name: 'preferences' });
              setOpen(false);
            }}
          >
            Preferences
          </a>
          <div className="userMenuSeparator" />
          <button
            className="userMenuItem userMenuLogout"
            onClick={() => {
              setOpen(false);
              Meteor.logout();
            }}
          >
            Logout
          </button>
        </div>
      )}
    </span>
  );
};
