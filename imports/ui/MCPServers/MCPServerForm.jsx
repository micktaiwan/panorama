import React, { useState, useEffect } from 'react';
import { Modal } from '../components/Modal/Modal.jsx';
import './MCPServerForm.css';

/**
 * Form for creating/editing MCP server configurations
 * Supports both stdio and HTTP connection types
 */
export function MCPServerForm({ server, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('stdio');
  const [enabled, setEnabled] = useState(true);

  // stdio fields
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envVars, setEnvVars] = useState('');

  // http fields
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');

  // Initialize form from server prop (edit mode)
  useEffect(() => {
    if (server) {
      setName(server.name || '');
      setType(server.type || 'stdio');
      setEnabled(server.enabled !== false);

      if (server.type === 'stdio') {
        setCommand(server.command || '');
        setArgs((server.args || []).join(' '));
        setEnvVars(formatEnvObject(server.env || {}));
      } else if (server.type === 'http') {
        setUrl(server.url || '');
        setHeaders(formatHeadersObject(server.headers || {}));
      }
    }
  }, [server]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const serverData = {
      name: name.trim(),
      enabled
    };

    // Only include type when creating (not when editing)
    if (!server) {
      serverData.type = type;
    }

    if (type === 'stdio') {
      serverData.command = command.trim();
      serverData.args = args.trim().split(/\s+/).filter(Boolean);
      serverData.env = parseEnvString(envVars);
    } else if (type === 'http') {
      serverData.url = url.trim();
      serverData.headers = parseHeadersString(headers);
    }

    onSave(serverData);
  };

  const handleTypeChange = (newType) => {
    setType(newType);
    // Clear fields from other type
    if (newType === 'stdio') {
      setUrl('');
      setHeaders('');
    } else {
      setCommand('');
      setArgs('');
      setEnvVars('');
    }
  };

  return (
    <Modal
      open={true}
      title={server ? 'Edit MCP Server' : 'Add MCP Server'}
      onClose={onCancel}
      size="large"
    >
      <form className="mcpServerForm" onSubmit={handleSubmit}>
        <div className="formGroup">
          <label htmlFor="name">Server Name *</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., notion, google-calendar"
            required
          />
          <small className="formHelp">Unique identifier for this server</small>
        </div>

        <div className="formGroup">
          <label htmlFor="type">Connection Type *</label>
          <select
            id="type"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value)}
            disabled={!!server} // Can't change type after creation
            required
          >
            <option value="stdio">stdio (Local subprocess)</option>
            <option value="http">http (Remote endpoint)</option>
          </select>
          <small className="formHelp">
            {type === 'stdio' && 'Local MCP server running as a subprocess'}
            {type === 'http' && 'Remote MCP server accessible via HTTP'}
          </small>
        </div>

        <div className="formGroup">
          <label htmlFor="enabled">
            <input
              id="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {' '}
            Enabled
          </label>
          <small className="formHelp">Disable to temporarily stop using this server</small>
        </div>

        {type === 'stdio' && (
          <>
            <div className="formGroup">
              <label htmlFor="command">Command *</label>
              <input
                id="command"
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., npx, node, /usr/local/bin/mcp-server"
                required
              />
              <small className="formHelp">Executable to run (must be in PATH or absolute path)</small>
            </div>

            <div className="formGroup">
              <label htmlFor="args">Arguments *</label>
              <input
                id="args"
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="e.g., @modelcontextprotocol/server-notion"
                required
              />
              <small className="formHelp">Space-separated arguments</small>
            </div>

            <div className="formGroup">
              <label htmlFor="envVars">Environment Variables (optional)</label>
              <textarea
                id="envVars"
                value={envVars}
                onChange={(e) => setEnvVars(e.target.value)}
                placeholder="KEY1=value1&#10;KEY2=value2"
                rows={4}
              />
              <small className="formHelp">One per line, format: KEY=value</small>
            </div>
          </>
        )}

        {type === 'http' && (
          <>
            <div className="formGroup">
              <label htmlFor="url">Endpoint URL *</label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                required
              />
              <small className="formHelp">HTTP endpoint for the MCP server</small>
            </div>

            <div className="formGroup">
              <label htmlFor="headers">HTTP Headers (optional)</label>
              <textarea
                id="headers"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                placeholder="X-API-Key: your-key&#10;Authorization: Bearer token"
                rows={4}
              />
              <small className="formHelp">One per line, format: Header-Name: value</small>
            </div>
          </>
        )}

        <div className="formActions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {server ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Helper: Format env object to string for display
 */
function formatEnvObject(env) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/**
 * Helper: Parse env string to object
 */
function parseEnvString(str) {
  const env = {};
  const lines = str.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }
  return env;
}

/**
 * Helper: Format headers object to string for display
 */
function formatHeadersObject(headers) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

/**
 * Helper: Parse headers string to object
 */
function parseHeadersString(str) {
  const headers = {};
  const lines = str.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join(':').trim();
    }
  }
  return headers;
}
