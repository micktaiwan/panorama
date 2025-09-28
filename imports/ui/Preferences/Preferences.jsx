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
  const [perplexityApiKey, setPerplexityApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  const [qdrantUrl, setQdrantUrl] = React.useState('');
  const [calendarIcsUrl, setCalendarIcsUrl] = React.useState('');
  const [health, setHealth] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [confirmIndex, setConfirmIndex] = React.useState(false);
  const [selectedKind, setSelectedKind] = React.useState('task');
  const [rawLines, setRawLines] = React.useState(null);
  const [fetchingLines, setFetchingLines] = React.useState(false);
  // indexJob: { jobId, total, processed, upserts, errors, done }
  const [indexJob, setIndexJob] = React.useState(null);
  // removed local toast; using global notify manager
  const [mobileTasksEnabled, setMobileTasksEnabled] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem('panorama.mobileTasksEnabled');
      return raw == null ? true : String(raw) === 'true';
    } catch (e) {
      console.warn('[prefs] localStorage read failed for panorama.mobileTasksEnabled', e);
      return true;
    }
  });
  const [lanIp, setLanIp] = React.useState('');

  // Ensure UI reflects actual server toggle on mount
  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getStatus', (err, res) => {
      if (err) {
        console.warn('[prefs] mobileTasksRoute.getStatus failed', err);
        return;
      }
      const sv = !!(res?.enabled);
      setMobileTasksEnabled(sv);
      try { window.localStorage.setItem('panorama.mobileTasksEnabled', String(sv)); } catch (e2) { console.warn('[prefs] localStorage write failed (sync from server)', e2); }
    });
  }, []);

  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getLanIps', (err, res) => {
      if (err) {
        console.warn('[prefs] getLanIps failed', err);
        setLanIp('');
        return;
      }
      const first = Array.isArray(res?.ips) && res.ips.length > 0 ? res.ips[0] : '';
      setLanIp(first);
    });
  }, []);

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
    setPerplexityApiKey(pref.perplexityApiKey || '');
    setPennyBaseUrl(pref.pennylaneBaseUrl || '');
    setPennyToken(pref.pennylaneToken || '');
    setQdrantUrl(pref.qdrantUrl || '');
    setCalendarIcsUrl(pref.calendarIcsUrl || '');
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
          <div className="prefsLabel">Mobile tasks page (LAN)</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={mobileTasksEnabled ? 'enabled' : 'disabled'}
              options={[{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]}
              onSubmit={(next) => {
                const v = next === 'enabled';
                setMobileTasksEnabled(v);
                try {
                  window.localStorage.setItem('panorama.mobileTasksEnabled', String(v));
                } catch (e) {
                  console.warn('[prefs] localStorage write failed for panorama.mobileTasksEnabled', e);
                }
                Meteor.call('mobileTasksRoute.setEnabled', v, () => {});
                notify({ message: `Mobile tasks page ${v ? 'enabled' : 'disabled'}`, kind: 'success' });
              }}
            />
            {lanIp ? <span className="ml8" style={{ color: 'var(--muted)' }}>{`http://${lanIp}:3000`}</span> : null}
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
          <div className="prefsLabel">Perplexity API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={perplexityApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPerplexityApiKey(next);
                Meteor.call('appPreferences.update', { perplexityApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Google Calendar</div>
          <div className="prefsValue">
            <div>
              <input
                className="afInput"
                type="text"
                placeholder="Paste your private ICS URL"
                value={calendarIcsUrl}
                onChange={(e) => setCalendarIcsUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div className="mt8">
              <button
                className="btn"
                onClick={() => {
                  const url = String(calendarIcsUrl || '').trim();
                  if (!url) { notify({ message: 'ICS URL missing', kind: 'error' }); return; }
                  Meteor.call('calendar.setIcsUrl', url, (err) => {
                    if (err) { notify({ message: err?.reason || err?.message || 'Save failed', kind: 'error' }); return; }
                    notify({ message: 'ICS URL saved', kind: 'success' });
                  });
                }}
              >Link with GCal</button>
              <a className="btn-link ml8" href="#/calendar" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'calendar' }); }}>Open Calendar</a>
            </div>
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

        <div className="prefsRow">
          <div className="prefsLabel">Debug last indexed</div>
          <div className="prefsValue">
            <button
              className="btn"
              disabled={fetchingLines}
              onClick={() => {
                setFetchingLines(true);
                Meteor.call('qdrant.lastIndexedRaw', (err, res) => {
                  setFetchingLines(false);
                  setRawLines(err ? { error: err?.reason || err?.message || String(err) } : res);
                });
              }}
            >
              {fetchingLines ? 'Fetching…' : 'Fetch last indexed (raw)'}
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Rebuild by kind</div>
          <div className="prefsValue">
            <select
              className="afInput"
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
            >
              <option value="project">Projects</option>
              <option value="task">Tasks</option>
              <option value="note">Notes</option>
              <option value="session">Sessions</option>
              <option value="line">Note lines</option>
              <option value="alarm">Alarms</option>
              <option value="link">Links</option>
              <option value="userlog">Logs</option>
            </select>
            <button
              className="btn ml8"
              disabled={indexing}
              onClick={() => {
                const kind = selectedKind;
                setIndexing(true);
                Meteor.call('qdrant.indexKindStart', kind, (err, res) => {
                  if (err || !res) {
                    setIndexing(false);
                    notify({ message: `Rebuild failed for ${kind}: ${err?.reason || err?.message || 'unknown error'}` , kind: 'error' });
                    return;
                  }
                  setIndexJob({ jobId: res.jobId, total: res.total, processed: 0, upserts: 0, errors: 0, done: false });
                  pollIndexStatus(res.jobId);
                });
              }}
            >
              {indexing ? 'Indexing…' : 'Rebuild selected'}
            </button>
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
        {rawLines ? (
          <div className="prefsRow">
            <div className="prefsLabel" />
            <div className="prefsValue"><pre className="prefsPre">{JSON.stringify(rawLines, null, 2)}</pre></div>
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


