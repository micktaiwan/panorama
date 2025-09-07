import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';

export const Preferences = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  React.useEffect(() => { if (pref) { setFilesDir(pref.filesDir || ''); setDevUrlMode(!!pref.devUrlMode); } }, [pref && pref._id]);
  if (sub()) return <div>Loading…</div>;
  return (
    <div>
      <h2>Preferences</h2>
      <div className="formRow">
        <label>Files directory</label>
        <input value={filesDir} onChange={(e) => setFilesDir(e.target.value)} placeholder="/path/to/filesDir" />
      </div>
      <div className="formRow">
        <label><input type="checkbox" checked={devUrlMode} onChange={(e) => setDevUrlMode(e.target.checked)} /> Use Dev URL instead of bundled server (when available)</label>
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => {
          Meteor.call('appPreferences.update', { filesDir, devUrlMode }, () => {});
        }}>Save</button>
      </div>
    </div>
  );
};


