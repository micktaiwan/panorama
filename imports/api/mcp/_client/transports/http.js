/**
 * HTTP transport for MCP protocol
 * Simple HTTP POST for JSON-RPC requests
 * Optional SSE support for server-initiated messages (not implemented yet)
 */

import fetch from 'node-fetch';
import { createRequest, getResult } from '/imports/api/mcp/_client/jsonrpc.js';
import * as connectionPool from '/imports/api/mcp/_client/connectionPool.js';

/**
 * HTTP connection wrapper
 */
class HttpConnection {
  constructor(serverId, config) {
    this.serverId = serverId;
    this.config = config;
    this.url = config.url;
    this.headers = config.headers || {};
    this.initialized = false;
  }

  /**
   * Initialize connection (MCP handshake)
   */
  async connect() {
    if (this.initialized) {
      return;
    }

    console.log(`[http] Connecting to ${this.url}`);

    // Initialize MCP connection
    const request = createRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
        sampling: {}
      },
      clientInfo: {
        name: 'panorama',
        version: '1.0.0'
      }
    });

    const response = await this.sendRequest(request);
    console.log(`[http] ${this.serverId} initialized:`, response);
    this.initialized = true;
  }

  /**
   * Send a JSON-RPC request via HTTP POST
   */
  async sendRequest(request, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * List tools
   */
  async listTools(timeout = 10000) {
    const request = createRequest('tools/list', {});
    const response = await this.sendRequest(request, timeout);
    return getResult(response);
  }

  /**
   * Call a tool
   */
  async callTool(toolName, args, timeout = 30000) {
    const request = createRequest('tools/call', {
      name: toolName,
      arguments: args
    });
    const response = await this.sendRequest(request, timeout);
    return getResult(response);
  }

  /**
   * Close connection (no-op for HTTP)
   */
  close() {
    console.log(`[http] ${this.serverId} closing connection`);
    this.initialized = false;
    connectionPool.remove(this.serverId, false);
  }
}

/**
 * Get or create an HTTP connection
 */
async function getOrCreateConnection(serverId, config) {
  let connection = connectionPool.get(serverId);

  if (!connection) {
    console.log(`[http] Creating new connection for ${serverId}`);
    connection = new HttpConnection(serverId, config);
    await connection.connect();
    connectionPool.set(serverId, connection);
  }

  return connection;
}

/**
 * List tools on an HTTP MCP server
 */
export async function listTools(serverId, config, timeout) {
  const connection = await getOrCreateConnection(serverId, config);
  return connection.listTools(timeout);
}

/**
 * Call a tool on an HTTP MCP server
 */
export async function callTool(serverId, config, toolName, args, timeout) {
  try {
    const connection = await getOrCreateConnection(serverId, config);
    return await connection.callTool(toolName, args, timeout);
  } catch (error) {
    // Remove from pool on error
    connectionPool.remove(serverId);
    throw error;
  }
}

/**
 * Close connection for a server
 */
export function closeConnection(serverId) {
  connectionPool.remove(serverId);
}
