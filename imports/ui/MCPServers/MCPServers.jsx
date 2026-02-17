import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { MCPServersCollection } from '../../api/mcpServers/collections.js';
import { notify } from '../utils/notify.js';
import { Modal } from '../components/Modal/Modal.jsx';
import { MCPServerForm } from './MCPServerForm.jsx';
import './MCPServers.css';

/**
 * MCP Servers management — Preferences tab
 * Configure external MCP servers (stdio/HTTP)
 */
export function MCPServers() {
  const isLoading = useSubscribe('mcpServers');
  const servers = useFind(() => MCPServersCollection.find({}, { sort: { createdAt: 1 } }));

  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [testingServer, setTestingServer] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [serverToRemove, setServerToRemove] = useState(null);

  const handleCreate = () => {
    setEditingServer(null);
    setShowForm(true);
  };

  const handleEdit = (server) => {
    setEditingServer(server);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingServer(null);
  };

  const handleSave = async (serverData) => {
    try {
      if (editingServer) {
        await Meteor.callAsync('mcpServers.update', editingServer._id, serverData);
        notify({ message: 'Server configuration updated', kind: 'success' });
      } else {
        await Meteor.callAsync('mcpServers.create', serverData);
        notify({ message: 'Server configuration created', kind: 'success' });
      }
      handleCloseForm();
    } catch (error) {
      console.error('[MCPServers] Save error:', error);
      notify({ message: error.reason || error.message || 'Failed to save server configuration', kind: 'error' });
    }
  };

  const handleRemoveClick = (server) => {
    setServerToRemove(server);
  };

  const handleRemoveConfirm = async () => {
    if (!serverToRemove) return;

    try {
      await Meteor.callAsync('mcpServers.remove', serverToRemove._id);
      notify({ message: 'Server configuration removed', kind: 'success' });
      setServerToRemove(null);
    } catch (error) {
      console.error('[MCPServers] Remove error:', error);
      notify({ message: error.reason || error.message || 'Failed to remove server', kind: 'error' });
    }
  };

  const handleRemoveCancel = () => {
    setServerToRemove(null);
  };

  const handleTestConnection = async (serverId, serverName) => {
    setTestingServer(serverId);
    try {
      const result = await Meteor.callAsync('mcpServers.testConnection', serverId);
      const toolCount = result.tools?.length || 0;
      notify({ message: `Connection successful! Found ${toolCount} tool(s) on "${serverName}"`, kind: 'success' });
    } catch (error) {
      console.error('[MCPServers] Test connection error:', error);
      notify({ message: error.reason || error.message || 'Connection test failed', kind: 'error' });
    } finally {
      setTestingServer(null);
    }
  };

  const handleToggleEnabled = async (serverId, currentEnabled) => {
    try {
      await Meteor.callAsync('mcpServers.update', serverId, { enabled: !currentEnabled });
      notify({ message: currentEnabled ? 'Server disabled' : 'Server enabled', kind: 'info' });
    } catch (error) {
      console.error('[MCPServers] Toggle enabled error:', error);
      notify({ message: error.reason || error.message || 'Failed to update server', kind: 'error' });
    }
  };

  const handleSyncFromClaudeDesktop = async () => {
    setSyncing(true);
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sync timeout after 10 seconds')), 10000)
      );
      const callPromise = Meteor.callAsync('mcpServers.syncFromClaudeDesktop');
      const result = await Promise.race([callPromise, timeoutPromise]);

      const { summary } = result;
      const parts = [];
      if (summary.imported > 0) parts.push(`${summary.imported} imported`);
      if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
      if (summary.errors > 0) parts.push(`${summary.errors} errors`);

      const message = parts.length > 0
        ? `Sync completed: ${parts.join(', ')}`
        : 'No servers to import';

      notify({ message, kind: summary.errors > 0 ? 'info' : 'success' });
    } catch (error) {
      console.error('[MCPServers] Sync error:', error);
      notify({ message: error.reason || error.message || 'Failed to sync from Claude Desktop', kind: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading()) return <div>Loading...</div>;

  return (
    <>
      <h3>MCP Servers</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Actions</div>
          <div className="prefsValue">
            <button
              className="btn"
              onClick={handleSyncFromClaudeDesktop}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync from Claude Desktop'}
            </button>
            <button className="btn ml8" onClick={handleCreate}>
              Add Server
            </button>
          </div>
        </div>

        <div className="prefsRow">
          <div className="prefsLabel">Servers ({servers.length})</div>
          <div className="prefsValue">
            {servers.length === 0 ? (
              <div className="muted">No MCP servers configured yet.</div>
            ) : (
              <div className="mcpServers-list">
                {servers.map(server => (
                  <div key={server._id} className="mcpServer-item">
                    <div className="mcpServer-header">
                      <div className="mcpServer-info">
                        <div className="mcpServer-name">
                          {server.name}
                          <span className={`mcpServer-type badge badge-${server.type}`}>
                            {server.type}
                          </span>
                          <span className={`mcpServer-status badge badge-${server.enabled ? 'success' : 'muted'}`}>
                            {server.enabled ? 'enabled' : 'disabled'}
                          </span>
                        </div>
                        {server.type === 'stdio' && (
                          <div className="mcpServer-command">
                            <code>{server.command} {server.args?.join(' ')}</code>
                          </div>
                        )}
                        {server.type === 'http' && (
                          <div className="mcpServer-url">
                            <code>{server.url}</code>
                          </div>
                        )}
                      </div>
                      <div className="mcpServer-actions">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleTestConnection(server._id, server.name)}
                          disabled={testingServer === server._id || !server.enabled}
                          title="Test connection"
                        >
                          {testingServer === server._id ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleToggleEnabled(server._id, server.enabled)}
                          title={server.enabled ? 'Disable' : 'Enable'}
                        >
                          {server.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleEdit(server)}
                          title="Edit configuration"
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleRemoveClick(server)}
                          title="Remove server"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {(server.lastConnectedAt || server.lastError) && (
                      <div className="mcpServer-meta">
                        {server.lastConnectedAt && (
                          <div className="mcpServer-lastConnected">
                            Last connected: {new Date(server.lastConnectedAt).toLocaleString()}
                          </div>
                        )}
                        {server.lastError && (
                          <div className="mcpServer-error">
                            Error: {server.lastError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showForm && (
        <MCPServerForm
          server={editingServer}
          onSave={handleSave}
          onCancel={handleCloseForm}
        />
      )}

      <Modal
        open={!!serverToRemove}
        onClose={handleRemoveCancel}
        title="Remove MCP Server"
        icon="⚠"
        actions={[
          <button key="cancel" className="btn btn-secondary" onClick={handleRemoveCancel}>
            Cancel
          </button>,
          <button key="confirm" className="btn btn-danger" onClick={handleRemoveConfirm}>
            Remove
          </button>
        ]}
      >
        <p>Remove "{serverToRemove?.name}"?</p>
        <p>This will permanently delete the server configuration.</p>
      </Modal>
    </>
  );
}
