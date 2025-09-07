import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';

export const QdrantPage = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [job, setJob] = useState(null);

  const refresh = () => {
    setLoading(true);
    Meteor.call('qdrant.health', (err, res) => {
      setLoading(false);
      if (err) {
        setHealth({ error: err.reason || err.message || String(err) });
      } else {
        setHealth(res);
      }
    });
  };

  useEffect(() => { refresh(); }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const doIndex = () => {
    setIndexing(true);
    Meteor.call('qdrant.indexStart', (err, res) => {
      if (err || !res) {
        setIndexing(false);
        setJob({ error: err?.reason || err?.message || 'start failed' });
        return;
      }
      setJob({ jobId: res.jobId, total: res.total, processed: 0 });
      const poll = () => {
        Meteor.call('qdrant.indexStatus', res.jobId, (e2, st) => {
          if (e2 || !st) { setIndexing(false); setJob({ error: e2?.reason || e2?.message || 'status failed' }); return; }
          setJob(st);
          if (st.done) { setIndexing(false); refresh(); }
          else setTimeout(poll, 800);
        });
      };
      poll();
    });
  };

  return (
    <div>
      <h2>Qdrant</h2>
      <div>
        <button className="btn" onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Check health'}</button>
        <button className="btn ml8" onClick={() => setConfirmOpen(true)} disabled={indexing}>{indexing ? 'Indexing…' : 'Index DB'}</button>
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Rebuild index?"
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmOpen(false)}>Cancel</button>,
          <button key="ok" className="btn" onClick={() => { setConfirmOpen(false); doIndex(); }}>Rebuild</button>
        ]}
      >
        <p>This will drop and recreate the Qdrant collection, then reindex all documents.</p>
      </Modal>
      <div style={{ marginTop: 12 }}>
        {health ? (
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(health, null, 2)}</pre>
        ) : null}
        {job ? (
          <div style={{ marginTop: 12 }}>
            {job.error ? (
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(job, null, 2)}</pre>
            ) : (
              <div>
                <div>Processed {job.processed}/{job.total} · Upserts {job.upserts} · Errors {job.errors}</div>
                <div style={{ background: '#222', height: 8, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#4ade80', height: 8, width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%` }} />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};


