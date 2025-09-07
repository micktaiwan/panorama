import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import './Preferences.css';

export const Preferences = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  const [openaiApiKey, setOpenaiApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  const [qdrantUrl, setQdrantUrl] = React.useState('');
  React.useEffect(() => { if (pref) { setFilesDir(pref.filesDir || ''); setDevUrlMode(!!pref.devUrlMode); setOpenaiApiKey(pref.openaiApiKey || ''); setPennyBaseUrl(pref.pennylaneBaseUrl || ''); setPennyToken(pref.pennylaneToken || ''); setQdrantUrl(pref.qdrantUrl || ''); } }, [pref && pref._id]);
  if (sub()) return <div>Loading…</div>;
  return (
    <div className="prefs">
      <h2>Preferences</h2>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Files directory</div>
          <div className="prefsValue">
            <InlineEditable
              value={filesDir}
              placeholder="/path/to/filesDir"
              fullWidth
              onSubmit={(next) => {
                setFilesDir(next);
                Meteor.call('appPreferences.update', { filesDir: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Qdrant URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={qdrantUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setQdrantUrl(next);
                Meteor.call('appPreferences.update', { qdrantUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Use Dev URL instead of bundled server</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={devUrlMode ? 'yes' : 'no'}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
              onSubmit={(next) => {
                const v = next === 'yes';
                setDevUrlMode(v);
                Meteor.call('appPreferences.update', { devUrlMode: v }, () => {});
              }}
            />
          </div>
        </div>
      </div>

      <h3>Secrets</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">OpenAI API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={openaiApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setOpenaiApiKey(next);
                Meteor.call('appPreferences.update', { openaiApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Base URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyBaseUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyBaseUrl(next);
                Meteor.call('appPreferences.update', { pennylaneBaseUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Token</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyToken}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyToken(next);
                Meteor.call('appPreferences.update', { pennylaneToken: next }, () => {});
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};


