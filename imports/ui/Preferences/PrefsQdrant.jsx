import React from 'react';
import { Meteor } from 'meteor/meteor';
import { Modal } from '../components/Modal/Modal.jsx';
import { navigateTo } from '../router.js';
import { notify } from '../utils/notify.js';

export const PrefsQdrant = ({ pref }) => {
  const [health, setHealth] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [confirmIndex, setConfirmIndex] = React.useState(false);
  const [selectedKind, setSelectedKind] = React.useState('task');
  const [rawLines, setRawLines] = React.useState(null);
  const [fetchingLines, setFetchingLines] = React.useState(false);
  const [indexJob, setIndexJob] = React.useState(null);

  const aiMode = pref?.ai?.mode || 'remote';
  const aiLocalEmbeddingModel = pref?.ai?.local?.embeddingModel || 'nomic-embed-text:latest';

  React.useEffect(() => {
    if (!pref) return;
    Meteor.call('qdrant.health', (err, res) => {
      if (!err && res) setHealth(res);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref?._id]);

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

  return (
    <>
      <h3>Qdrant</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Health</div>
          <div className="prefsValue">
            <button className="btn" disabled={checking} onClick={() => {
              setChecking(true);
              Meteor.call('qdrant.health', (err, res) => { setChecking(false); setHealth(err ? { error: err?.reason || err?.message || String(err) } : res); });
            }}>{checking ? 'Checking...' : 'Check health'}</button>
            <button className="btn ml8" disabled={indexing} onClick={() => setConfirmIndex(true)}>{indexing ? 'Indexing...' : 'Rebuild index'}</button>
            <button className="btn ml8" onClick={() => navigateTo({ name: 'searchQuality' })}>Search Quality Test</button>
          </div>
        </div>

        {health?.collection && (
          <div className="prefsRow">
            <div className="prefsLabel">Active Collection</div>
            <div className="prefsValue">
              <code style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', color: 'var(--text-primary)' }}>
                {health.collection}
              </code>
              <span style={{ marginLeft: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                {aiMode === 'remote' ? 'Base collection (no model suffix)' : 'Model-specific collection'}
              </span>
              {health.incompatible && (
                <div style={{ marginTop: '8px', padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: '4px', fontSize: '13px', color: 'var(--warning-text)' }}>
                  Collection incompatible with current model. Expected {health.expectedVectorSize} dimensions, but collection has {health.vectorSize} dimensions.
                  <br />
                  <button className="btn" style={{ marginTop: '4px', fontSize: '12px', padding: '2px 8px' }} onClick={() => setConfirmIndex(true)}>
                    Recreate Collection
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

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
              {fetchingLines ? 'Fetching...' : 'Fetch last indexed (raw)'}
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Rebuild by kind</div>
          <div className="prefsValue">
            <select className="afInput" value={selectedKind} onChange={(e) => setSelectedKind(e.target.value)}>
              <option value="project">Projects</option>
              <option value="task">Tasks</option>
              <option value="note">Notes</option>
              <option value="session">Sessions</option>
              <option value="line">Note lines</option>
              <option value="alarm">Alarms</option>
              <option value="link">Links</option>
              <option value="userlog">Logs</option>
              <option value="email">Emails</option>
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
                    notify({ message: `Rebuild failed for ${kind}: ${err?.reason || err?.message || 'unknown error'}`, kind: 'error' });
                    return;
                  }
                  setIndexJob({ jobId: res.jobId, total: res.total, processed: 0, upserts: 0, errors: 0, done: false });
                  pollIndexStatus(res.jobId);
                });
              }}
            >
              {indexing ? 'Indexing...' : 'Rebuild selected'}
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
                {`${indexJob.processed || 0}/${indexJob.total || 0} chunks processed · ${indexJob.upserts || 0} upserts · ${indexJob.errors || 0} errors`}
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
        title={health?.incompatible ? 'Rebuild blocked — dimension mismatch' : 'Rebuild Qdrant index?'}
        actions={health?.incompatible
          ? [<button key="close" className="btn" onClick={() => setConfirmIndex(false)}>Close</button>]
          : [
            <button key="cancel" className="btn" onClick={() => setConfirmIndex(false)}>Cancel</button>,
            <button key="ok" className="btn" onClick={() => { setConfirmIndex(false); startRebuild(); }}>Rebuild</button>
          ]}
      >
        {health?.incompatible ? (
          <>
            <p>The Qdrant collection <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '3px', fontSize: '13px' }}>{health.collection}</code> uses <strong>{health.vectorSize}</strong>-dimension vectors, but your current embedding model produces <strong>{health.expectedVectorSize}</strong>-dimension vectors.</p>
            <p style={{ marginTop: '12px' }}>Rebuilding would require deleting the entire shared collection, which would <strong>erase all users' search index</strong>.</p>
            <p style={{ marginTop: '12px', padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: '4px', fontSize: '13px', color: 'var(--warning-text)' }}>
              To fix this, either switch back to the embedding model that matches {health.vectorSize} dimensions, or ask an admin to manually recreate the Qdrant collection.
            </p>
          </>
        ) : (
          <>
            <p>This will clear your indexed vectors and reindex all your documents.</p>
            <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              <strong>Collection:</strong> <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '3px', fontSize: '13px' }}>
                {aiMode === 'remote' ? 'panorama' : `panorama_${aiLocalEmbeddingModel.replace(/[^a-zA-Z0-9]/g, '_')}`}
              </code>
              <span style={{ marginLeft: '8px', fontSize: '12px' }}>
                ({aiMode === 'remote' ? 'Base collection' : 'Model-specific collection'})
              </span>
            </p>
          </>
        )}
      </Modal>
    </>
  );
};
