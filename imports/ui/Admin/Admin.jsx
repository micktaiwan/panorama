import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { navigateTo } from '/imports/ui/router.js';
import { AdminUsers } from './AdminUsers.jsx';
import { AdminStats } from './AdminStats.jsx';
import { AdminReleases } from './AdminReleases.jsx';
import './Admin.css';

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'releases', label: 'Releases' },
];

export const Admin = ({ tab }) => {
  const user = useTracker(() => Meteor.user(), []);
  const activeTab = TABS.find(t => t.id === tab) ? tab : 'users';

  if (!user?.isAdmin) {
    return (
      <div className="prefs">
        <div className="prefsContent">
          <h2>Access denied</h2>
          <p>You do not have admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prefs">
      <nav className="prefsSidebar">
        <h2 style={{ margin: '0 0 12px 0' }}>Admin</h2>
        <ul>
          {TABS.map(t => (
            <li key={t.id}>
              <a
                href={`#/admin${t.id === 'users' ? '' : `/${t.id}`}`}
                className={activeTab === t.id ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo({ name: 'admin', tab: t.id });
                }}
              >
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="prefsContent">
        {activeTab === 'users' && <AdminUsers />}
        {activeTab === 'monitoring' && <AdminStats />}
        {activeTab === 'releases' && <AdminReleases />}
      </div>
    </div>
  );
};
