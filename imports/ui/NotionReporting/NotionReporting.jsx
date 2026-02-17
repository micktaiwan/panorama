import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { NotionIntegrationsCollection } from '../../api/notionIntegrations/collections';
import { NotionTicketsCollection } from '../../api/notionTickets/collections';
import { ConfigForm } from './ConfigForm.jsx';
import { TicketsList } from './TicketsList.jsx';
import { notify } from '../utils/notify.js';
import { Modal } from '../components/Modal/Modal.jsx';
import './NotionReporting.css';

export const NotionReporting = () => {
  const sub = useSubscribe('notionIntegrations');
  const integrations = useFind(() => NotionIntegrationsCollection.find({}, { sort: { createdAt: -1 } }));

  const [selectedIntegrationId, setSelectedIntegrationId] = useState(null);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Subscribe to tickets for selected integration
  const ticketsSub = useSubscribe('notionTickets.byIntegration', selectedIntegrationId || '__none__');
  const _ticketsLoading = ticketsSub();
  const tickets = useFind(() =>
    NotionTicketsCollection.find(
      selectedIntegrationId ? { integrationId: selectedIntegrationId } : { _id: '__none__' },
      { sort: { syncedAt: -1 } }
    ),
    [selectedIntegrationId]
  );

  const selectedIntegration = integrations.find(i => i._id === selectedIntegrationId);

  // Read sync state from integration document
  const syncInProgress = selectedIntegration?.syncInProgress || false;
  const syncProgress = selectedIntegration?.syncProgress || null;

  const handleCreateConfig = () => {
    setEditingConfig(null);
    setShowConfigForm(true);
  };

  const handleEditConfig = (integration) => {
    setEditingConfig(integration);
    setShowConfigForm(true);
  };

  const handleCloseForm = () => {
    setShowConfigForm(false);
    setEditingConfig(null);
  };

  const handleDeleteConfig = (integration, e) => {
    if (e?.shiftKey) {
      Meteor.call('notionIntegrations.remove', integration._id, (err) => {
        if (err) notify({ message: `Failed to delete: ${err.reason || err.message}`, kind: 'error' });
        else {
          notify({ message: 'Integration deleted', kind: 'success' });
          if (selectedIntegrationId === integration._id) setSelectedIntegrationId(null);
        }
      });
    } else {
      setConfirmDelete(integration);
    }
  };

  const confirmDeleteConfig = () => {
    if (!confirmDelete) return;

    Meteor.call('notionIntegrations.remove', confirmDelete._id, (err) => {
      if (err) {
        notify({ message: `Failed to delete: ${err.reason || err.message}`, kind: 'error' });
      } else {
        notify({ message: 'Integration deleted', kind: 'success' });
        if (selectedIntegrationId === confirmDelete._id) {
          setSelectedIntegrationId(null);
          // Tickets and pagination state will disappear automatically via reactive subscription
        }
      }
      setConfirmDelete(null);
    });
  };

  const handleSelectIntegration = (integrationId) => {
    setSelectedIntegrationId(integrationId);
    // Tickets and pagination state will load automatically via reactive subscription
  };

  const handleSyncAll = () => {
    if (!selectedIntegrationId) return;

    setLoading(true);
    Meteor.call('notionIntegrations.syncAll', selectedIntegrationId, (err, result) => {
      setLoading(false);

      if (err) {
        notify({ message: `Sync failed: ${err.reason || err.message}`, kind: 'error' });
        console.error('[syncAll] Error:', err);
        return;
      }

      // Tickets and sync state are updated via reactive subscription
      notify({
        message: `Sync complete: ${result.totalTickets} ticket(s) from ${result.pageCount} page(s)`,
        kind: 'success'
      });
    });
  };

  const handleCancelSync = () => {
    if (!selectedIntegrationId) return;

    Meteor.call('notionIntegrations.cancelSync', selectedIntegrationId, (err) => {
      if (err) {
        notify({ message: `Cancel failed: ${err.reason || err.message}`, kind: 'error' });
        return;
      }

      notify({ message: 'Cancelling sync...', kind: 'info' });
    });
  };

  if (sub()) {
    return <div>Loading…</div>;
  }

  return (
    <div className="notionReporting">
      <div className="notionHeader">
        <h2>Notion Reporting</h2>
        <button className="btn" onClick={handleCreateConfig}>
          + New Integration
        </button>
      </div>

      {integrations.length === 0 ? (
        <div className="emptyState">
          <p>No Notion integrations configured yet.</p>
          <p>Create one to start tracking tickets from your Notion databases.</p>
        </div>
      ) : (
        <div className="notionLayout">
          <div className="notionSidebar">
            <h3>Integrations</h3>
            <ul className="integrationsList">
              {integrations.map(integration => (
                <li
                  key={integration._id}
                  className={`integrationItem ${selectedIntegrationId === integration._id ? 'active' : ''} ${!integration.enabled ? 'disabled' : ''}`}
                >
                  <div
                    className="integrationName"
                    onClick={() => handleSelectIntegration(integration._id)}
                  >
                    {integration.name}
                    {!integration.enabled && <span className="disabledLabel"> (disabled)</span>}
                  </div>
                  <div className="integrationActions">
                    <button
                      className="btn-link"
                      onClick={(e) => { e.stopPropagation(); handleEditConfig(integration); }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-link ml8"
                      onClick={(e) => { e.stopPropagation(); handleDeleteConfig(integration); }}
                    >
                      Delete
                    </button>
                  </div>
                  {integration.lastSyncAt && (
                    <div className="integrationMeta">
                      Last sync: {new Date(integration.lastSyncAt).toLocaleString()}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="notionContent">
            {selectedIntegration ? (
              <>
                <div className="contentHeader">
                  <div>
                    <h3>{selectedIntegration.name}</h3>
                    {selectedIntegration.description && (
                      <p className="integrationDescription">{selectedIntegration.description}</p>
                    )}
                  </div>
                  <div className="contentHeaderActions">
                    {syncInProgress ? (
                      <>
                        <div className="syncProgress">
                          {syncProgress?.status || 'Syncing...'}
                          {syncProgress?.current > 0 && ` (${syncProgress.current} tickets)`}
                        </div>
                        <button
                          className="btn"
                          onClick={handleCancelSync}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn"
                        onClick={handleSyncAll}
                        disabled={loading || !selectedIntegration.enabled}
                      >
                        {loading ? 'Loading…' : 'Sync All'}
                      </button>
                    )}
                  </div>
                </div>

                {!selectedIntegration.enabled && (
                  <div className="warningBanner">
                    This integration is disabled. Enable it in settings to fetch tickets.
                  </div>
                )}

                {tickets.length > 0 ? (
                  <TicketsList tickets={tickets} />
                ) : (
                  <div className="emptyState">
                    <p>No tickets loaded yet.</p>
                    <p>Click "Sync All" to fetch tickets from Notion.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="emptyState">
                <p>Select an integration from the sidebar to view tickets.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showConfigForm && (
        <Modal
          open={showConfigForm}
          onClose={handleCloseForm}
          title={editingConfig ? 'Edit Integration' : 'New Integration'}
        >
          <ConfigForm
            integration={editingConfig}
            onClose={handleCloseForm}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          title="Delete Integration?"
          actions={[
            <button key="cancel" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>,
            <button key="delete" className="btn" onClick={confirmDeleteConfig}>Delete</button>
          ]}
        >
          <p>Are you sure you want to delete "{confirmDelete.name}"?</p>
          <p>This action cannot be undone.</p>
        </Modal>
      )}
    </div>
  );
};
