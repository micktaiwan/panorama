/**
 * MCP Client - Core implementation
 * Generic MCP client using JSON-RPC 2.0 protocol
 * Supports stdio and HTTP transports
 */

import * as stdioTransport from './transports/stdio.js';
import * as httpTransport from './transports/http.js';

/**
 * Call a tool on an MCP server
 * @param {Object} serverConfig - Server configuration from DB (must include _id and type)
 * @param {String} toolName - Tool name
 * @param {Object} args - Tool arguments
 * @param {Number} timeout - Optional timeout in milliseconds
 * @returns {Promise<Object>} Tool result
 */
export async function callTool(serverConfig, toolName, args, timeout) {
  validateConfig(serverConfig);

  const { _id: serverId, type } = serverConfig;

  if (type === 'stdio') {
    validateStdioConfig(serverConfig);
    return stdioTransport.callTool(serverId, serverConfig, toolName, args, timeout);
  } else if (type === 'http') {
    validateHttpConfig(serverConfig);
    return httpTransport.callTool(serverId, serverConfig, toolName, args, timeout);
  } else {
    throw new Error(`Unknown server type: ${type}`);
  }
}

/**
 * List tools available on an MCP server
 * @param {Object} serverConfig - Server configuration from DB (must include _id and type)
 * @param {Number} timeout - Optional timeout in milliseconds
 * @returns {Promise<Object>} { tools: [...] }
 */
export async function listTools(serverConfig, timeout) {
  validateConfig(serverConfig);

  const { _id: serverId, type } = serverConfig;

  if (type === 'stdio') {
    validateStdioConfig(serverConfig);
    return stdioTransport.listTools(serverId, serverConfig, timeout);
  } else if (type === 'http') {
    validateHttpConfig(serverConfig);
    return httpTransport.listTools(serverId, serverConfig, timeout);
  } else {
    throw new Error(`Unknown server type: ${type}`);
  }
}

/**
 * Initialize connection with MCP server
 * Note: Initialization happens automatically on first use
 * This method is kept for backward compatibility
 * @param {Object} serverConfig - Server configuration from DB
 * @param {Number} timeout - Optional timeout in milliseconds
 * @returns {Promise<Object>} Server info (includes list of tools)
 */
export async function initialize(serverConfig, timeout) {
  // Initialization is automatic, just call listTools to verify connection
  return listTools(serverConfig, timeout);
}

/**
 * Close connection for a specific server
 * @param {Object} serverConfig - Server configuration from DB (must include _id and type)
 */
export function closeConnection(serverConfig) {
  if (!serverConfig?._id || !serverConfig?.type) {
    return;
  }

  const { _id: serverId, type } = serverConfig;

  if (type === 'stdio') {
    stdioTransport.closeConnection(serverId);
  } else if (type === 'http') {
    httpTransport.closeConnection(serverId);
  }
}

/**
 * Validate basic server configuration
 */
function validateConfig(serverConfig) {
  if (!serverConfig) {
    throw new Error('Server configuration is required');
  }
  if (!serverConfig._id) {
    throw new Error('Server configuration missing required field: _id');
  }
  if (!serverConfig.type) {
    throw new Error('Server configuration missing required field: type');
  }
}

/**
 * Validate stdio-specific configuration
 */
function validateStdioConfig(config) {
  if (!config.command) {
    throw new Error('Stdio server config missing required field: command');
  }
  if (!Array.isArray(config.args)) {
    throw new Error('Stdio server config missing or invalid field: args (must be array)');
  }
}

/**
 * Validate HTTP-specific configuration
 */
function validateHttpConfig(config) {
  if (!config.url) {
    throw new Error('HTTP server config missing required field: url');
  }
}
