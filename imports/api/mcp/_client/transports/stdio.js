/**
 * Stdio transport for MCP protocol
 * Spawns a child process and communicates via stdin/stdout
 */

import { spawn } from 'child_process';
import { createRequest, getResult } from '/imports/api/mcp/_client/jsonrpc.js';
import * as connectionPool from '/imports/api/mcp/_client/connectionPool.js';

/**
 * Stdio connection wrapper
 */
class StdioConnection {
  constructor(serverId, config) {
    this.serverId = serverId;
    this.config = config;
    this.process = null;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.initialized = false;
    this._cleanupCalled = false;
  }

  /**
   * Start the child process and setup communication
   */
  async connect() {
    if (this.process) {
      return; // Already connected
    }

    // Reset cleanup flag for new connection
    this._cleanupCalled = false;

    console.log(`[stdio] Spawning process: ${this.config.command} ${this.config.args.join(' ')}`);

    // Spawn child process
    this.process = spawn(this.config.command, this.config.args, {
      env: {
        ...process.env,
        ...(this.config.env || {})
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdout (JSON-RPC responses)
    this.process.stdout.on('data', (data) => {
      this.handleData(data);
    });

    // Handle stderr (logs)
    this.process.stderr.on('data', (data) => {
      console.error(`[stdio] ${this.serverId} stderr:`, data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(`[stdio] ${this.serverId} process exited: code=${code} signal=${signal}`);
      this.cleanup();
    });

    // Handle errors
    this.process.on('error', (error) => {
      console.error(`[stdio] ${this.serverId} process error:`, error);
      this.cleanup();
    });

    // Initialize connection (MCP handshake)
    await this.initialize();
  }

  /**
   * Initialize MCP connection (handshake)
   */
  async initialize() {
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
    console.log(`[stdio] ${this.serverId} initialized:`, response);
    this.initialized = true;

    // Send initialized notification
    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    };
    this.send(notification);
  }

  /**
   * Handle incoming data from stdout
   */
  handleData(data) {
    this.buffer += data.toString();

    // Process complete JSON-RPC messages (newline-delimited)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (e) {
        console.error(`[stdio] ${this.serverId} failed to parse message:`, line, e);
      }
    }
  }

  /**
   * Handle a complete JSON-RPC message
   */
  handleMessage(message) {
    // If message has an id, it's a response to a request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        pending.resolve(message);
        this.pendingRequests.delete(message.id);
      }
    } else {
      // It's a notification or server-initiated request
      console.log(`[stdio] ${this.serverId} received notification:`, message);
    }
  }

  /**
   * Send a JSON-RPC message
   */
  send(message) {
    if (!this.process?.stdin) {
      throw new Error('Process not connected');
    }

    const json = JSON.stringify(message) + '\n';
    this.process.stdin.write(json);
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  sendRequest(request, timeout = 30000) {
    return new Promise((resolve, reject) => {
      // Store pending request
      this.pendingRequests.set(request.id, { resolve, reject });

      // Setup timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Resolve handler that clears timeout
      const originalResolve = this.pendingRequests.get(request.id).resolve;
      this.pendingRequests.get(request.id).resolve = (response) => {
        clearTimeout(timer);
        originalResolve(response);
      };

      // Send request
      try {
        this.send(request);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(request.id);
        reject(error);
      }
    });
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
   * Close connection
   */
  close() {
    if (this.process) {
      console.log(`[stdio] ${this.serverId} closing connection`);
      this.cleanup();  // Cleanup first (removes listeners)
      // Process is killed in cleanup()
    }
  }

  /**
   * Cleanup resources - removes all listeners and kills process
   */
  cleanup() {
    // Prevent multiple cleanup calls (exit + error can both fire)
    if (this._cleanupCalled) return;
    this._cleanupCalled = true;

    const proc = this.process;

    // Reject all pending requests
    for (const [_id, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    // Clean up process listeners and streams BEFORE killing
    if (proc) {
      // Remove all event listeners to prevent zombie processes
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();

      // Destroy streams
      proc.stdin?.destroy();
      proc.stdout?.destroy();
      proc.stderr?.destroy();

      // Kill the process if still running
      if (!proc.killed) {
        try {
          proc.kill('SIGTERM');
          // Force kill after 1 second if still running
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 1000);
        } catch (_err) {
          // Process may already be dead
        }
      }
    }

    this.process = null;
    this.initialized = false;
    connectionPool.remove(this.serverId, false);
  }
}

/**
 * Get or create a stdio connection
 */
async function getOrCreateConnection(serverId, config) {
  let connection = connectionPool.get(serverId);

  if (!connection) {
    console.log(`[stdio] Creating new connection for ${serverId}`);
    connection = new StdioConnection(serverId, config);
    await connection.connect();
    connectionPool.set(serverId, connection);
  }

  return connection;
}

/**
 * List tools on a stdio MCP server
 */
export async function listTools(serverId, config, timeout) {
  const connection = await getOrCreateConnection(serverId, config);
  return connection.listTools(timeout);
}

/**
 * Call a tool on a stdio MCP server
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
