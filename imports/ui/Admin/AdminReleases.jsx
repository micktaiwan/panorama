import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ReleasesCollection } from '/imports/api/releases/collections';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';

export const AdminReleases = () => {
  const isLoading = useSubscribe('releases.all');
  const releases = useFind(() => ReleasesCollection.find({}, { sort: { createdAt: -1 } }), []);

  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleCreate = (e) => {
    e.preventDefault();
    if (!version.trim() || !title.trim()) return;
    setCreating(true);
    Meteor.call('releases.insert', { version, title, content }, (err) => {
      setCreating(false);
      if (err) {
        notify({ message: err.reason || err.message, kind: 'error' });
        return;
      }
      notify({ message: 'Release created', kind: 'success' });
      setVersion('');
      setTitle('');
      setContent('');
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    Meteor.call('releases.remove', deleteTarget._id, (err) => {
      setDeleteTarget(null);
      if (err) {
        notify({ message: err.reason || err.message, kind: 'error' });
        return;
      }
      notify({ message: 'Release deleted', kind: 'success' });
    });
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  if (isLoading()) return <div>Loading releases...</div>;

  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0' }}>Create test release</h3>
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Version
          <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Release title" required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
          Content (markdown)
          <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Release notes..." />
        </label>
        <button className="btn" type="submit" disabled={creating}>
          {creating ? 'Creating...' : 'Create test release'}
        </button>
      </form>

      <h3 style={{ margin: '0 0 16px 0' }}>Releases ({releases.length})</h3>
      <table className="adminTable">
        <thead>
          <tr>
            <th>Version</th>
            <th>Title</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r) => (
            <tr key={r._id}>
              <td>{r.version}</td>
              <td>{r.title}</td>
              <td>{fmt(r.createdAt)}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {releases.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16 }}>No releases yet</td></tr>
          )}
        </tbody>
      </table>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete release"
        actions={[
          <button key="cancel" className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>,
          <button key="delete" className="btn btn-danger" onClick={handleDelete}>Delete</button>,
        ]}
      >
        <p>Are you sure you want to delete release <strong>{deleteTarget?.version}</strong> — {deleteTarget?.title}?</p>
      </Modal>
    </div>
  );
};
