import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { MCPServersCollection } from '../../api/mcpServers/collections.js';
import { notify } from '../utils/notify.js';
import './ConfigForm.css';

// Predefined owner IDs from team-data-reporting.md
const PREDEFINED_OWNERS = [
  { id: 'b3384638-30d0-4811-ba70-70ad6f592325', name: 'Eliott Bennaceur' },
  { id: 'fe77554b-355c-4a6a-987a-35bb97e06620', name: 'Ibrahim FALA' },
  { id: 'aa7ab4e7-ef07-4761-9f10-2b990a2bdda4', name: 'Ahmed Kooli' }
];

const LIFECYCLE_OPTIONS = [
  '🔨 Ongoing',
  '🚚 Delivering',
  '🛠 R&D',
  '📦 Shaped',
  '🪩 Discovered'
];

export const ConfigForm = ({ integration, onClose }) => {
  // Check if Notion MCP server is configured
  const isLoadingServers = useSubscribe('mcpServers');
  const allServers = useFind(() => MCPServersCollection.find({ enabled: true }));
  const notionServer = allServers.find(s => s.name?.toLowerCase() === 'notion');

  const [name, setName] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [description, setDescription] = useState('');
  const [squadName, setSquadName] = useState('');
  const [selectedLifecycles, setSelectedLifecycles] = useState([]);
  const [selectedOwnerIds, setSelectedOwnerIds] = useState([]);
  const [ownerMapping, setOwnerMapping] = useState({});
  const [pageSize, setPageSize] = useState(3);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (integration) {
      setName(integration.name || '');
      setDatabaseId(integration.databaseId || '');
      setDescription(integration.description || '');
      setSquadName(integration.filters?.squadName || '');
      setSelectedLifecycles(integration.filters?.lifecycle || []);
      setSelectedOwnerIds(integration.filters?.ownerIds || []);
      setOwnerMapping(integration.ownerMapping || {});
      setPageSize(integration.pageSize || 3);
      setEnabled(integration.enabled !== false);
    }
  }, [integration]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!name.trim()) {
      notify({ message: 'Name is required', kind: 'error' });
      return;
    }

    if (!databaseId.trim()) {
      notify({ message: 'Database ID is required', kind: 'error' });
      return;
    }

    const doc = {
      name: name.trim(),
      databaseId: databaseId.trim(),
      description: description.trim(),
      filters: {
        squadName: squadName.trim(),
        lifecycle: selectedLifecycles,
        ownerIds: selectedOwnerIds
      },
      ownerMapping,
      pageSize,
      enabled
    };

    setSaving(true);

    const method = integration ? 'notionIntegrations.update' : 'notionIntegrations.create';
    const args = integration ? [integration._id, doc] : [doc];

    Meteor.call(method, ...args, (err) => {
      setSaving(false);

      if (err) {
        notify({ message: `Failed to save: ${err.reason || err.message}`, kind: 'error' });
      } else {
        notify({
          message: integration ? 'Integration updated' : 'Integration created',
          kind: 'success'
        });
        onClose();
      }
    });
  };

  const handleToggleLifecycle = (lifecycle) => {
    setSelectedLifecycles(prev =>
      prev.includes(lifecycle)
        ? prev.filter(l => l !== lifecycle)
        : [...prev, lifecycle]
    );
  };

  const handleToggleOwner = (ownerId) => {
    setSelectedOwnerIds(prev =>
      prev.includes(ownerId)
        ? prev.filter(id => id !== ownerId)
        : [...prev, ownerId]
    );

    // Auto-populate ownerMapping if not already set
    if (!ownerMapping[ownerId]) {
      const owner = PREDEFINED_OWNERS.find(o => o.id === ownerId);
      if (owner) {
        setOwnerMapping(prev => ({ ...prev, [ownerId]: owner.name }));
      }
    }
  };

  return (
    <form className="configForm" onSubmit={handleSubmit}>
      {!isLoadingServers() && !notionServer && (
        <div className="configForm-warning">
          <strong>⚠️ No Notion MCP server configured</strong>
          <p>
            This integration requires a Notion MCP server to fetch data.
            Please add a Notion server in{' '}
            <a href="#/mcp-servers">Preferences → MCP Servers</a>.
          </p>
        </div>
      )}

      <div className="formGroup">
        <label htmlFor="name">Name *</label>
        <input
          id="name"
          type="text"
          className="afInput"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Stories - Squad Data"
          required
        />
      </div>

      <div className="formGroup">
        <label htmlFor="databaseId">Database ID *</label>
        <input
          id="databaseId"
          type="text"
          className="afInput"
          value={databaseId}
          onChange={(e) => setDatabaseId(e.target.value)}
          placeholder="e.g., 4b1d291764884eab9d798e887edd68f0"
          required
        />
        <div className="formHint">
          The Notion database ID (without dashes)
        </div>
      </div>

      <div className="formGroup">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          className="afInput"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
        />
      </div>

      <div className="formGroup">
        <label htmlFor="squadName">Squad Name (Filter)</label>
        <input
          id="squadName"
          type="text"
          className="afInput"
          value={squadName}
          onChange={(e) => setSquadName(e.target.value)}
          placeholder="e.g., Data"
        />
        <div className="formHint">
          Filter by Squad name rollup field
        </div>
      </div>

      <div className="formGroup">
        <label>Lifecycle (Filter)</label>
        <div className="checkboxGroup">
          {LIFECYCLE_OPTIONS.map(lifecycle => (
            <label key={lifecycle} className="checkboxLabel">
              <input
                type="checkbox"
                checked={selectedLifecycles.includes(lifecycle)}
                onChange={() => handleToggleLifecycle(lifecycle)}
              />
              <span>{lifecycle}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="formGroup">
        <label>Owners (Filter)</label>
        <div className="checkboxGroup">
          {PREDEFINED_OWNERS.map(owner => (
            <label key={owner.id} className="checkboxLabel">
              <input
                type="checkbox"
                checked={selectedOwnerIds.includes(owner.id)}
                onChange={() => handleToggleOwner(owner.id)}
              />
              <span>{owner.name}</span>
            </label>
          ))}
        </div>
        <div className="formHint">
          Select team members to include in results
        </div>
      </div>

      <div className="formGroup">
        <label htmlFor="pageSize">Page Size</label>
        <input
          id="pageSize"
          type="number"
          className="afInput"
          value={pageSize}
          onChange={(e) => setPageSize(parseInt(e.target.value) || 3)}
          min={1}
          max={10}
        />
        <div className="formHint">
          Recommended: 3 (to avoid Notion API token limits)
        </div>
      </div>

      <div className="formGroup">
        <label className="checkboxLabel">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </div>

      <div className="formActions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
};
