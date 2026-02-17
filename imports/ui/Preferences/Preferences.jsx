import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind, useTracker } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '../../api/appPreferences/collections';
import { UserPreferencesCollection } from '../../api/userPreferences/collections';
import { navigateTo } from '../router.js';
import './Preferences.css';

import { PrefsSecrets } from './PrefsSecrets.jsx';
import { PrefsAI } from './PrefsAI.jsx';
import { PrefsQdrant } from './PrefsQdrant.jsx';
import { PrefsCommands } from './PrefsCommands.jsx';
import { PrefsDebug } from './PrefsDebug.jsx';
import { PrefsProfile } from './PrefsProfile.jsx';
import { PrefsPages } from './PrefsPages.jsx';
import { MCPServers } from '../MCPServers/MCPServers.jsx';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'ai', label: 'AI' },
  { id: 'qdrant', label: 'Qdrant' },
  { id: 'mcpServers', label: 'MCP Servers' },
  { id: 'commands', label: 'Commands' },
  { id: 'pages', label: 'Pages', adminOnly: true },
  { id: 'debug', label: 'Debug', adminOnly: true },
];

export const Preferences = ({ tab }) => {
  const user = useTracker(() => Meteor.user(), []);
  const isAdmin = !!user?.isAdmin;
  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);
  const activeTab = visibleTabs.find(t => t.id === tab) ? tab : 'profile';

  const sub = useSubscribe('appPreferences');
  const subUser = useSubscribe('userPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const userPref = useFind(() => UserPreferencesCollection.find({}, { limit: 1 }))[0];

  React.useEffect(() => {
    Meteor.call('userPreferences.ensure');
  }, []);

  if (sub() || subUser()) return <div>Loading...</div>;

  return (
    <div className="prefs">
      <nav className="prefsSidebar">
        <h2 style={{ margin: '0 0 12px 0' }}>Preferences</h2>
        <ul>
          {visibleTabs.map(t => (
            <li key={t.id}>
              <a
                href={`#/preferences${t.id === 'profile' ? '' : `/${t.id}`}`}
                className={activeTab === t.id ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo({ name: 'preferences', tab: t.id });
                }}
              >
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="prefsContent">
        {activeTab === 'profile' && <PrefsProfile />}
        {activeTab === 'secrets' && <PrefsSecrets pref={pref} userPref={userPref} />}
        {activeTab === 'ai' && <PrefsAI pref={pref} userPref={userPref} />}
        {activeTab === 'qdrant' && <PrefsQdrant pref={pref} />}
        {activeTab === 'mcpServers' && <MCPServers />}
        {activeTab === 'commands' && <PrefsCommands />}
        {activeTab === 'pages' && <PrefsPages />}
        {activeTab === 'debug' && <PrefsDebug />}
      </div>
    </div>
  );
};
