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
            href="#/preferences"
            className="userMenuItem"
            onClick={(e) => {
              e.preventDefault();
              navigateTo({ name: 'preferences' });
              setOpen(false);
            }}
          >
            <svg className="menuIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5l1.1 2.6 2.9.2-2.2 1.9.7 2.8L8 7.5 5.5 9l.7-2.8L4 4.3l2.9-.2L8 1.5zM2.5 8A5.5 5.5 0 0 0 8 13.5 5.5 5.5 0 0 0 13.5 8h1A6.5 6.5 0 0 1 8 14.5 6.5 6.5 0 0 1 1.5 8h1z"/></svg>
            Preferences
          </a>
          {user?.isAdmin && (
            <a
              href="#/admin"
              className="userMenuItem"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ name: 'admin' });
                setOpen(false);
              }}
            >
              <svg className="menuIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1l1.8 1.2L12 2l.8 2.2L15 5.8l-1 2L15 10.2l-2.2.8L12 14l-2.2-1L8 15l-1.8-1.2L4 14l-.8-2.2L1 10.2l1-2L1 5.8l2.2-.8L4 2l2.2 1L8 1zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
              Admin
            </a>
          )}
          <div className="userMenuSeparator" />
          <button
            className="userMenuItem userMenuLogout"
            onClick={() => {
              setOpen(false);
              Meteor.logout();
            }}
          >
            <svg className="menuIcon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6 2v2H3v8h3v2H1V2h5zm4.3 3.3L13.6 8l-3.3 2.7-.6-.7L11.4 8.5H5v-1h6.4L9.7 6l.6-.7z"/></svg>
            Logout
          </button>
        </div>
      )}
    </span>
  );
};
