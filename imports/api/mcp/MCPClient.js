/**
 * MCP Client - Main API for calling external MCP servers
 * Generic JSON-RPC 2.0 based MCP client
 * Supports both stdio (local) and HTTP (remote) connections with persistent connections
 */

import * as mcpClient from '/imports/api/mcp/_client/MCPClient.js';

export const MCPClient = {
  /**
   * Call a tool on an MCP server
   * @param {Object} serverConfig - Server configuration from DB (must include _id)
   * @param {String} toolName - Tool name (e.g., "mcp__notion__API-post-database-query")
   * @param {Object} args - Tool arguments
   * @param {Number} timeout - Optional timeout in milliseconds
   * @returns {Promise<Object>} Tool result
   */
  async callTool(serverConfig, toolName, args, timeout) {
    return mcpClient.callTool(serverConfig, toolName, args, timeout);
  },

  /**
   * List tools available on an MCP server
   * @param {Object} serverConfig - Server configuration from DB (must include _id)
   * @param {Number} timeout - Optional timeout in milliseconds
   * @returns {Promise<Object>} { tools: [...] }
   */
  async listTools(serverConfig, timeout) {
    return mcpClient.listTools(serverConfig, timeout);
  },

  /**
   * Initialize connection with MCP server (handshake)
   * Note: Initialization happens automatically on first use
   * This method is kept for backward compatibility and delegates to listTools
   * @param {Object} serverConfig - Server configuration from DB
   * @param {Number} timeout - Optional timeout in milliseconds
   * @returns {Promise<Object>} Server info (includes list of tools)
   */
  async initialize(serverConfig, timeout) {
    return mcpClient.initialize(serverConfig, timeout);
  },

  /**
   * Close connection for a specific server
   * Useful when updating server configuration or removing a server
   * @param {Object} serverConfig - Server configuration from DB (must include _id and type)
   */
  closeConnection(serverConfig) {
    return mcpClient.closeConnection(serverConfig);
  }
};
