import React, { useEffect, useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import { timeAgo, formatDateTime } from '/imports/ui/utils/date.js';

export const AdminUsers = () => {
  const currentUser = useTracker(() => Meteor.user(), []);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [sortKey, setSortKey] = useState('lastLoginAt');
  const [sortDir, setSortDir] = useState('desc');

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

  const columns = [
    { key: 'name', label: 'Name', defaultDir: 'asc' },
    { key: 'email', label: 'Email', defaultDir: 'asc' },
    { key: 'createdAt', label: 'Created', defaultDir: 'desc' },
    { key: 'lastLoginAt', label: 'Last login', defaultDir: 'desc' },
    { key: null, label: 'Admin' },
    { key: 'counts.projects', label: 'Projects', defaultDir: 'desc' },
    { key: 'counts.tasks', label: 'Tasks', defaultDir: 'desc' },
    { key: 'counts.notes', label: 'Notes', defaultDir: 'desc' },
    { key: 'counts.files', label: 'Files', defaultDir: 'desc' },
    { key: null, label: 'Actions' },
  ];

  const getValue = (u, key) => {
    if (key.startsWith('counts.')) return u.counts?.[key.split('.')[1]] ?? 0;
    return u[key];
  };

  const sortedUsers = useMemo(() => {
    const list = [...users];
    list.sort((a, b) => {
      const va = getValue(a, sortKey);
      const vb = getValue(b, sortKey);
      // Push nulls/undefined to the end regardless of direction
      if (va === null || va === undefined) { if (vb === null || vb === undefined) return 0; return 1; }
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [users, sortKey, sortDir]);

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      const col = columns.find((c) => c.key === key);
      setSortKey(key);
      setSortDir(col?.defaultDir || 'asc');
    }
  };

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
            {columns.map((col) => (
              <th
                key={col.label}
                className={col.key ? 'sortable' : undefined}
                onClick={col.key ? () => handleSort(col.key) : undefined}
              >
                {col.label}
                {col.key === sortKey && <span className="sortArrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((u) => {
            const isSelf = u._id === currentUser?._id;
            return (
              <tr key={u._id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td title={formatDateTime(u.createdAt)}>{timeAgo(u.createdAt) || '-'}</td>
                <td title={formatDateTime(u.lastLoginAt)}>{timeAgo(u.lastLoginAt) || '-'}</td>
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
