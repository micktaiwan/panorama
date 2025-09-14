import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '../../api/appPreferences/collections';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import './Preferences.css';
import { Modal } from '../components/Modal/Modal.jsx';
import { navigateTo } from '../router.js';
import { notify } from '../utils/notify.js';
import { playBeep } from '../utils/sound.js';

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
  // indexJob: { jobId, total, processed, upserts, errors, done }
  const [indexJob, setIndexJob] = React.useState(null);
  // removed local toast; using global notify manager

  const pollIndexStatus = React.useCallback((jobId) => {
    Meteor.call('qdrant.indexStatus', jobId, (e2, st) => {
      if (e2 || !st) {
        setIndexing(false);
        setIndexJob(null);
        setHealth({ error: e2?.reason || e2?.message || 'status failed' });
        notify({ message: `Index status failed: ${e2?.reason || e2?.message || 'unknown error'}`, kind: 'error' });
        return;
      }
      setIndexJob({ ...st, jobId });
      if (st.done) {
        setIndexing(false);
        notify({ message: 'Index rebuild completed', kind: 'success' });
        Meteor.call('qdrant.health', (e3, r3) => setHealth(e3 ? { error: e3?.reason || e3?.message || String(e3) } : r3));
      } else {
        setTimeout(() => pollIndexStatus(jobId), 800);
      }
    });
  }, []);

  const startRebuild = React.useCallback(() => {
    setIndexing(true);
    Meteor.call('qdrant.indexStart', (err, res) => {
      if (err || !res) {
        setIndexing(false);
        setHealth({ error: err?.reason || err?.message || 'start failed' });
        notify({ message: `Index start failed: ${err?.reason || err?.message || 'unknown error'}`, kind: 'error' });
        return;
      }
      setIndexJob({ jobId: res.jobId, total: res.total, processed: 0, upserts: 0, errors: 0, done: false });
      pollIndexStatus(res.jobId);
    });
  }, [pollIndexStatus]);
  React.useEffect(() => {
    if (!pref) return;
    setFilesDir(pref.filesDir || '');
    setDevUrlMode(!!pref.devUrlMode);
    setOpenaiApiKey(pref.openaiApiKey || '');
    setPennyBaseUrl(pref.pennylaneBaseUrl || '');
    setPennyToken(pref.pennylaneToken || '');
    setQdrantUrl(pref.qdrantUrl || '');
  }, [pref?._id]);
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

      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Display</div>
          <div className="prefsValue">
            <button
              className="btn"
              onClick={() => {
                if (window.electron?.resetZoom) {
                  window.electron.resetZoom();
                  notify({ message: 'Zoom reset to 100%', kind: 'success' });
                } else {
                  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '');
                  const msg = isElectron
                    ? 'Zoom reset not available yet. Please restart the app to enable it.'
                    : 'Zoom reset not available in browser';
                  notify({ message: msg, kind: 'error' });
                }
              }}
            >
              Reset zoom (100%)
            </button>
          </div>
        </div>
      </div>

      <h3>Test notify</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Notifications</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              playBeep(0.5);
              notify({ message: 'Test beep played', kind: 'success' });
            }}>Test audio</button>
            <button className="btn ml8" onClick={() => {
              setTimeout(() => {
                playBeep(0.5);
                notify({ message: 'Delayed test: beep + notify', kind: 'success' });
              }, 3000);
            }}>Test delayed audio (3s)</button>
            <button className="btn ml8" onClick={() => {
              const tests = [
                { message: 'Info notify test', kind: 'info' },
                { message: 'Success notify test', kind: 'success' },
                { message: 'Error notify test', kind: 'error' }
              ];
              tests.forEach((t, i) => setTimeout(() => notify(t), i * 1200));
            }}>Test all notify</button>
          </div>
        </div>
      </div>

      <h3>Test errors</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Client and Server</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              setTimeout(() => { throw new Error('Test client error'); }, 0);
            }}>Throw error</button>
            <button className="btn ml8" onClick={() => {
              Promise.reject(new Error('Test unhandled rejection'));
            }}>Unhandled rejection</button>
            <button className="btn ml8" onClick={() => {
              Meteor.call('nonexistent.method');
            }}>Fail method</button>
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
        {indexJob ? (
          <div className="prefsRow">
            <div className="prefsLabel">Index progress</div>
            <div className="prefsValue">
              <div className="progressBar" aria-label="Indexing progress">
                <div className="progressBarFill" style={{ width: `${Math.min(100, Math.round(((indexJob.processed || 0) / Math.max(1, indexJob.total || 0)) * 100))}%` }} />
              </div>
              <div className="progressText">
                {`${indexJob.processed || 0}/${indexJob.total || 0} processed · ${indexJob.upserts || 0} upserts · ${indexJob.errors || 0} errors`}
              </div>
            </div>
          </div>
        ) : null}
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
          <button key="ok" className="btn" onClick={() => { setConfirmIndex(false); startRebuild(); }}>Rebuild</button>
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


