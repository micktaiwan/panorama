import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';

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
        <InlineEditable value={filesDir} placeholder="/path/to/filesDir" onSubmit={(next) => setFilesDir(next)} fullWidth />
      </div>
      <div className="formRow">
        <label>Use Dev URL instead of bundled server</label>
        <InlineEditable as="select" value={devUrlMode ? 'yes' : 'no'} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} onSubmit={(next) => setDevUrlMode(next === 'yes')} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => {
          Meteor.call('appPreferences.update', { filesDir, devUrlMode, openaiApiKey, pennylaneBaseUrl: pennyBaseUrl, pennylaneToken: pennyToken }, () => {});
        }}>Save</button>
      </div>
      <h3 style={{ marginTop: 24 }}>Secrets</h3>
      <div className="formRow">
        <label>OpenAI API Key</label>
        <InlineEditable value={openaiApiKey} placeholder="sk-..." onSubmit={(next) => setOpenaiApiKey(next)} fullWidth />
      </div>
      <div className="formRow">
        <label>Pennylane Base URL</label>
        <InlineEditable value={pennyBaseUrl} placeholder="https://app.pennylane.com/api/external/v2/" onSubmit={(next) => setPennyBaseUrl(next)} fullWidth />
      </div>
      <div className="formRow">
        <label>Pennylane Token</label>
        <InlineEditable value={pennyToken} placeholder="token..." onSubmit={(next) => setPennyToken(next)} fullWidth />
      </div>
    </div>
  );
};


