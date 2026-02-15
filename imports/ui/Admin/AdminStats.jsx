import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Card } from '/imports/ui/components/Card/Card.jsx';
import { notify } from '/imports/ui/utils/notify.js';

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

export const AdminStats = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStats = () => {
    setLoading(true);
    Meteor.call('admin.getStats', (err, res) => {
      setLoading(false);
      if (err) {
        notify({ message: `Failed to load stats: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setStats(res);
    });
  };

  useEffect(() => { loadStats(); }, []);

  if (loading) return <div>Loading stats...</div>;
  if (!stats) return <div>No stats available.</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Monitoring</h3>
        <button className="btn" onClick={loadStats}>Refresh</button>
      </div>

      <div className="adminStatsGrid">
        {[
          ['Users', stats.users],
          ['Projects', stats.projects],
          ['Tasks', stats.tasks],
          ['Notes', stats.notes],
          ['Files', stats.files],
        ].map(([label, value]) => (
          <div key={label} className="adminStatTile">
            <div className="adminStatTileLabel">{label}</div>
            <div className="adminStatValue">{value}</div>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: 24 }}>Qdrant</h4>
      <Card>
        {stats.qdrant.available ? (
          <div className="adminStatsDetail">
            <div><span className="adminStatsLabel">Status:</span> <span className="adminStatusOk">Connected</span></div>
            <div><span className="adminStatsLabel">Collection:</span> {stats.qdrant.collection}</div>
            <div><span className="adminStatsLabel">Points:</span> {stats.qdrant.pointsCount ?? '-'}</div>
            <div><span className="adminStatsLabel">Index status:</span> {stats.qdrant.status ?? '-'}</div>
          </div>
        ) : (
          <div className="adminStatsDetail">
            <div><span className="adminStatsLabel">Status:</span> <span className="adminStatusError">Unavailable</span></div>
            {stats.qdrant.error && <div><span className="adminStatsLabel">Error:</span> {stats.qdrant.error}</div>}
          </div>
        )}
      </Card>

      {stats.disk && (
        <>
          <h4 style={{ marginTop: 24 }}>Disk Usage</h4>
          <Card>
            <div className="adminStatsDetail">
              <div><span className="adminStatsLabel">Directory:</span> {stats.disk.dir}</div>
              <div><span className="adminStatsLabel">Files:</span> {stats.disk.fileCount}</div>
              <div><span className="adminStatsLabel">Total size:</span> {formatBytes(stats.disk.totalBytes)}</div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
