import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import './Onboarding.css';
import { navigateTo } from '/imports/ui/router.js';

export const Onboarding = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const ready = !sub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (pref && typeof pref.filesDir === 'string') setFilesDir(pref.filesDir); }, [pref && pref._id]);
  if (!ready) return <div>Loading…</div>;
  const save = () => {
    Meteor.call('appPreferences.update', { filesDir, onboardedAt: true }, () => {
      navigateTo({ name: 'preferences' });
    });
  };
  return (
    <div>
      <h2>Welcome to Panorama</h2>
      <p>Choose where to store uploaded files on this machine:</p>
      <div>
        <input value={filesDir || ''} onChange={(e) => setFilesDir(e.target.value)} placeholder="/path/to/filesDir" className="onbInput" />
      </div>
      <p className="onbNote">
        Qdrant (vector database) is required for semantic search. By default, Panorama expects a local instance at
        {' '}<code>http://localhost:6333</code>. You can change the Qdrant URL later in Preferences.
      </p>
      <div className="onbActions">
        <button className="btn btn-primary" disabled={!filesDir} onClick={save}>Continue</button>
      </div>
    </div>
  );
};


