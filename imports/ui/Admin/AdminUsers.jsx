import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';

export const AdminUsers = () => {
  const currentUser = useTracker(() => Meteor.user(), []);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadUsers = () => {
    setLoading(true);
    Meteor.call('admin.getUsers', (err, res) => {
      setLoading(false);
      if (err) {
        notify({ message: `Failed to load users: ${err.reason || err.message}`, kind: 'error' });
        return;
      }
      setUsers(res || []);
    });
  };

  useEffect(() => { loadUsers(); }, []);

  const handleToggleAdmin = (userId, newValue) => {
    Meteor.call('admin.setAdmin', userId, newValue, (err) => {
      if (err) {
        notify({ message: err.reason || err.message, kind: 'error' });
        return;
      }
      notify({ message: newValue ? 'User promoted to admin' : 'Admin revoked', kind: 'success' });
      loadUsers();
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    Meteor.call('admin.deleteUser', deleteTarget._id, (err, res) => {
      setDeleteTarget(null);
      if (err) {
        notify({ message: err.reason || err.message, kind: 'error' });
        return;
      }
      notify({ message: `User deleted (${res?.deletedDocuments || 0} documents removed)`, kind: 'success' });
      loadUsers();
    });
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  if (loading) return <div>Loading users...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Users ({users.length})</h3>
        <button className="btn" onClick={loadUsers}>Refresh</button>
      </div>
      <table className="adminTable">
        <thead>
          <tr>
            <th>Email</th>
            <th>Created</th>
            <th>Last login</th>
            <th>Admin</th>
            <th>Projects</th>
            <th>Tasks</th>
            <th>Notes</th>
            <th>Files</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u._id === currentUser?._id;
            return (
              <tr key={u._id}>
                <td>{u.email}</td>
                <td>{fmt(u.createdAt)}</td>
                <td>{fmt(u.lastLoginAt)}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={u.isAdmin}
                    disabled={isSelf}
                    onChange={(e) => handleToggleAdmin(u._id, e.target.checked)}
                  />
                </td>
                <td>{u.counts.projects}</td>
                <td>{u.counts.tasks}</td>
                <td>{u.counts.notes}</td>
                <td>{u.counts.files}</td>
                <td>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={isSelf}
                    onClick={() => setDeleteTarget(u)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete user"
        actions={[
          <button key="cancel" className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>,
          <button key="delete" className="btn btn-danger" onClick={handleDelete}>Delete</button>,
        ]}
      >
        <p>Are you sure you want to delete <strong>{deleteTarget?.email}</strong>?</p>
        <p>All their data (projects, tasks, notes, files, etc.) will be permanently deleted.</p>
      </Modal>
    </div>
  );
};
