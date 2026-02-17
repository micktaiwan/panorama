import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useFind } from 'meteor/react-meteor-data';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';
import { OPTIONAL_PAGES } from '/imports/ui/router.js';

export const PrefsPages = () => {
  const userPref = useFind(() => UserPreferencesCollection.find({}, { limit: 1 }))[0];
  const visiblePages = userPref?.visiblePages || [];

  const toggle = (key) => {
    const next = visiblePages.includes(key)
      ? visiblePages.filter(k => k !== key)
      : [...visiblePages, key];
    Meteor.call('userPreferences.update', { visiblePages: next });
  };

  const entries = Object.entries(OPTIONAL_PAGES);

  return (
    <div>
      <h2>Pages</h2>
      <p className="muted">Enable optional pages in the navigation. These pages are hidden by default.</p>
      {entries.length === 0 && <p className="muted">No optional pages configured.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {entries.map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={visiblePages.includes(key)}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
};
