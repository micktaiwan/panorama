import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '/imports/api/appPreferences/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import './Preferences.css';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { navigateTo } from '/imports/ui/router.js';

export const Preferences = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  const [openaiApiKey, setOpenaiApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  const [qdrantUrl, setQdrantUrl] = React.useState('');
  const [health, setHealth] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [confirmIndex, setConfirmIndex] = React.useState(false);
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

      <h3>Qdrant</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Health</div>
          <div className="prefsValue">
            <button className="btn" disabled={checking} onClick={() => {
              setChecking(true);
              Meteor.call('qdrant.health', (err, res) => { setChecking(false); setHealth(err ? { error: err?.reason || err?.message || String(err) } : res); });
            }}>{checking ? 'Checking…' : 'Check health'}</button>
            <button className="btn ml8" disabled={indexing} onClick={() => setConfirmIndex(true)}>{indexing ? 'Indexing…' : 'Rebuild index'}</button>
          </div>
        </div>
        {health ? (
          <div className="prefsRow">
            <div className="prefsLabel" />
            <div className="prefsValue"><pre className="prefsPre">{JSON.stringify(health, null, 2)}</pre></div>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmIndex}
        onClose={() => setConfirmIndex(false)}
        title="Rebuild Qdrant index?"
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmIndex(false)}>Cancel</button>,
          <button key="ok" className="btn" onClick={() => {
            setConfirmIndex(false);
            setIndexing(true);
            Meteor.call('qdrant.indexStart', (err, res) => {
              if (err || !res) { setIndexing(false); setHealth({ error: err?.reason || err?.message || 'start failed' }); return; }
              const poll = () => {
                Meteor.call('qdrant.indexStatus', res.jobId, (e2, st) => {
                  if (e2 || !st) { setIndexing(false); setHealth({ error: e2?.reason || e2?.message || 'status failed' }); return; }
                  if (st.done) { setIndexing(false); Meteor.call('qdrant.health', (e3, r3) => setHealth(e3 ? { error: e3?.reason || e3?.message || String(e3) } : r3)); }
                  else setTimeout(poll, 800);
                });
              };
              poll();
            });
          }}>Rebuild</button>
        ]}
      >
        <p>This will drop and recreate the collection, then reindex all documents.</p>
      </Modal>
      <div className="prefsFooter">
        <a href="#/onboarding" className="btn-link" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'onboarding' }); }}>Open Onboarding</a>
      </div>
    </div>
  );
}


