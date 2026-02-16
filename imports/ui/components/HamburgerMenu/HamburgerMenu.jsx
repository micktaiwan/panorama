import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { navigateTo, ADMIN_ROUTES } from '/imports/ui/router.js';
import './HamburgerMenu.css';

export const HamburgerMenu = ({ user, onNewSession, onExport }) => {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const nav = (route) => {
    navigateTo(route);
    close();
  };

  const action = (fn) => {
    fn();
    close();
  };

  const navItems = [
    { label: 'Panorama', route: { name: 'home' } },
    { label: 'Overview', route: { name: 'dashboard' } },
    { label: 'Notes', route: { name: 'notes' } },
    { label: 'Journal', route: { name: 'userlog' } },
    { label: 'Emails', route: { name: 'emails' } },
    { label: 'Calendar', route: { name: 'calendar' } },
    { label: 'Alarms', route: { name: 'alarms' } },
    'separator',
    { label: 'Eisenhower', route: { name: 'eisenhower' } },
    { label: 'Budget', route: { name: 'budget' } },
    { label: 'Reporting', route: { name: 'reporting' } },
    { label: 'Situation Analyzer', route: { name: 'situationAnalyzer' } },
    'separator',
    { label: 'People', route: { name: 'people' } },
    { label: 'Files', route: { name: 'files' } },
    { label: 'Links', route: { name: 'links' } },
    { label: 'Web Search', route: { name: 'web' } },
    { label: 'Claude Code', route: { name: 'claude' } },
    { label: 'Notion', route: { name: 'notionReporting' } },
    'separator',
    { label: 'New Note Session', action: onNewSession },
    { label: 'Import tasks', route: { name: 'importTasks' } },
    { label: 'Export', action: onExport },
    'separator',
    { label: 'Help', route: { name: 'help' } },
    { label: 'Preferences', route: { name: 'preferences' } },
    { label: 'Admin', route: { name: 'admin' } },
    'separator',
    { label: 'Logout', action: () => Meteor.logout() },
  ].filter(item => typeof item === 'string' || !item.route || !ADMIN_ROUTES.has(item.route.name) || user?.isAdmin);

  return (
    <>
      <button
        className="hamburgerBtn"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
      >
        &#x2261;
      </button>
      <div
        className={`hamburgerBackdrop${open ? ' open' : ''}`}
        onClick={close}
      />
      <div className={`hamburgerDrawer${open ? ' open' : ''}`}>
        <div className="hamburgerDrawerHeader">
          <span className="hamburgerDrawerTitle">Navigation</span>
          <button className="hamburgerCloseBtn" onClick={close} aria-label="Close menu">
            &times;
          </button>
        </div>
        <ul className="hamburgerNav">
          {navItems.map((item, i) => {
            if (item === 'separator') {
              return <li key={`sep-${i}`}><div className="hamburgerNavSeparator" /></li>;
            }
            if (item.action) {
              return (
                <li key={item.label}>
                  <a
                    href="#/"
                    className="hamburgerNavLink"
                    onClick={(e) => { e.preventDefault(); action(item.action); }}
                  >
                    {item.label}
                  </a>
                </li>
              );
            }
            return (
              <li key={item.label}>
                <a
                  href="#/"
                  className="hamburgerNavLink"
                  onClick={(e) => { e.preventDefault(); nav(item.route); }}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
};

HamburgerMenu.propTypes = {
  user: PropTypes.object,
  onNewSession: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
};
