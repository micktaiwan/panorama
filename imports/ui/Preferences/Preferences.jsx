import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '../../api/appPreferences/collections';
import { UserPreferencesCollection } from '../../api/userPreferences/collections';
import { navigateTo } from '../router.js';
import './Preferences.css';

import { PrefsGeneral } from './PrefsGeneral.jsx';
import { PrefsSecrets } from './PrefsSecrets.jsx';
import { PrefsAI } from './PrefsAI.jsx';
import { PrefsQdrant } from './PrefsQdrant.jsx';
import { PrefsCommands } from './PrefsCommands.jsx';
import { PrefsDebug } from './PrefsDebug.jsx';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'ai', label: 'AI' },
  { id: 'qdrant', label: 'Qdrant' },
  { id: 'commands', label: 'Commands' },
  { id: 'debug', label: 'Debug' },
];

export const Preferences = ({ tab }) => {
  const activeTab = TABS.find(t => t.id === tab) ? tab : 'general';

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
          {TABS.map(t => (
            <li key={t.id}>
              <a
                href={`#/preferences${t.id === 'general' ? '' : `/${t.id}`}`}
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
        <div className="prefsFooter" style={{ marginTop: '24px' }}>
          <a href="#/onboarding" className="btn-link" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'onboarding' }); }}>
            Open Onboarding
          </a>
        </div>
      </nav>
      <div className="prefsContent">
        {activeTab === 'general' && <PrefsGeneral pref={pref} userPref={userPref} />}
        {activeTab === 'secrets' && <PrefsSecrets pref={pref} userPref={userPref} />}
        {activeTab === 'ai' && <PrefsAI pref={pref} userPref={userPref} />}
        {activeTab === 'qdrant' && <PrefsQdrant pref={pref} />}
        {activeTab === 'commands' && <PrefsCommands />}
        {activeTab === 'debug' && <PrefsDebug />}
      </div>
    </div>
  );
};
