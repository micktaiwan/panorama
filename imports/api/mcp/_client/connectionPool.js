/**
 * Connection pool for persistent MCP connections
 * Manages stdio and HTTP connections with automatic cleanup
 */

const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_IDLE_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Connection pool: serverId -> { connection, lastUsed }
 */
const pool = new Map();

/**
 * Periodic cleanup of idle connections
 */
setInterval(() => {
  const now = Date.now();
  for (const [serverId, entry] of pool.entries()) {
    if (now - entry.lastUsed > MAX_IDLE_TIME) {
      console.log(`[connectionPool] Closing idle connection for server ${serverId}`);
      try {
        if (entry.connection.close) {
          entry.connection.close();
        }
      } catch (e) {
        console.error(`[connectionPool] Error closing connection:`, e);
      }
      pool.delete(serverId);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Get connection from pool
 * @param {String} serverId
 * @returns {Object|null} Connection object or null if not found
 */
export function get(serverId) {
  const entry = pool.get(serverId);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.connection;
  }
  return null;
}

/**
 * Store connection in pool
 * @param {String} serverId
 * @param {Object} connection - Connection object (must have close() method)
 */
export function set(serverId, connection) {
  pool.set(serverId, {
    connection,
    lastUsed: Date.now()
  });
}

/**
 * Remove connection from pool
 * @param {String} serverId
 * @param {Boolean} closeConnection - Whether to call close() on the connection
 */
export function remove(serverId, closeConnection = true) {
  const entry = pool.get(serverId);
  if (entry && closeConnection) {
    try {
      if (entry.connection.close) {
        entry.connection.close();
      }
    } catch (e) {
      console.error(`[connectionPool] Error closing connection:`, e);
    }
  }
  pool.delete(serverId);
}

/**
 * Clear all connections
 * @param {Boolean} closeConnections - Whether to call close() on all connections
 */
export function clear(closeConnections = true) {
  if (closeConnections) {
    for (const [serverId, entry] of pool.entries()) {
      try {
        if (entry.connection.close) {
          entry.connection.close();
        }
      } catch (e) {
        console.error(`[connectionPool] Error closing connection for ${serverId}:`, e);
      }
    }
  }
  pool.clear();
}
