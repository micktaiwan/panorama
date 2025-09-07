import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';

export const Preferences = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  const [openaiApiKey, setOpenaiApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  React.useEffect(() => { if (pref) { setFilesDir(pref.filesDir || ''); setDevUrlMode(!!pref.devUrlMode); setOpenaiApiKey(pref.openaiApiKey || ''); setPennyBaseUrl(pref.pennylaneBaseUrl || ''); setPennyToken(pref.pennylaneToken || ''); } }, [pref && pref._id]);
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
          Meteor.call('appPreferences.update', { filesDir, devUrlMode, openaiApiKey, pennylaneBaseUrl: pennyBaseUrl, pennylaneToken: pennyToken }, () => {});
        }}>Save</button>
      </div>
      <h3 style={{ marginTop: 24 }}>Secrets</h3>
      <div className="formRow">
        <label>OpenAI API Key</label>
        <input type="password" value={openaiApiKey} onChange={(e) => setOpenaiApiKey(e.target.value)} placeholder="sk-..." />
      </div>
      <div className="formRow">
        <label>Pennylane Base URL</label>
        <input value={pennyBaseUrl} onChange={(e) => setPennyBaseUrl(e.target.value)} placeholder="https://app.pennylane.com/api/external/v2/" />
      </div>
      <div className="formRow">
        <label>Pennylane Token</label>
        <input type="password" value={pennyToken} onChange={(e) => setPennyToken(e.target.value)} placeholder="token..." />
      </div>
    </div>
  );
};


