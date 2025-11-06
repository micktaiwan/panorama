import { Mongo } from 'meteor/mongo';

export const MCPServersCollection = new Mongo.Collection('mcpServers');

/**
 * Schema for MCP Server configurations
 * Supports both stdio (local) and HTTP (remote) MCP servers
 */
export const MCP_SERVER_SCHEMA = {
  name: {
    type: String,
    required: true,
    description: 'Unique name for this MCP server (e.g., "notion", "google-calendar")'
  },
  type: {
    type: String,
    required: true,
    allowedValues: ['stdio', 'http'],
    description: 'Connection type: stdio (local subprocess) or http (remote endpoint)'
  },
  enabled: {
    type: Boolean,
    defaultValue: true,
    description: 'Whether this server is active'
  },

  // stdio-specific fields
  command: {
    type: String,
    optional: true,
    description: 'Command to execute (e.g., "npx", "/usr/local/bin/node"). Required for stdio type.'
  },
  args: {
    type: Array,
    optional: true,
    description: 'Arguments for the command (e.g., ["@modelcontextprotocol/server-notion"]). Required for stdio type.'
  },
  'args.$': {
    type: String
  },
  env: {
    type: Object,
    optional: true,
    defaultValue: {},
    description: 'Environment variables for the subprocess (e.g., { NOTION_API_KEY: "secret_..." })'
  },

  // http-specific fields
  url: {
    type: String,
    optional: true,
    description: 'HTTP endpoint URL (e.g., "https://app.lemlist.com/mcp"). Required for http type.'
  },
  headers: {
    type: Object,
    optional: true,
    defaultValue: {},
    description: 'HTTP headers to send with requests (e.g., { "X-API-Key": "..." })'
  },

  // Status tracking
  createdAt: {
    type: Date,
    defaultValue: () => new Date()
  },
  lastConnectedAt: {
    type: Date,
    optional: true,
    description: 'Timestamp of last successful connection'
  },
  lastError: {
    type: String,
    optional: true,
    description: 'Last error message (if any)'
  }
};
