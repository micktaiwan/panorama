/**
 * JSON-RPC 2.0 helpers for MCP protocol
 * https://www.jsonrpc.org/specification
 * https://spec.modelcontextprotocol.io/specification/basic/utilities/
 */

let requestId = 1;

/**
 * Generate next request ID
 * @returns {Number}
 */
export function nextId() {
  return requestId++;
}

/**
 * Create a JSON-RPC 2.0 request
 * @param {String} method - RPC method name
 * @param {Object} params - Method parameters
 * @param {Number} id - Optional request ID (auto-generated if not provided)
 * @returns {Object} JSON-RPC request object
 */
export function createRequest(method, params = {}, id = null) {
  return {
    jsonrpc: '2.0',
    id: id ?? nextId(),
    method,
    params
  };
}

/**
 * Create a JSON-RPC 2.0 notification (no response expected)
 * @param {String} method - RPC method name
 * @param {Object} params - Method parameters
 * @returns {Object} JSON-RPC notification object
 */
export function createNotification(method, params = {}) {
  return {
    jsonrpc: '2.0',
    method,
    params
  };
}

/**
 * Check if response is an error
 * @param {Object} response - JSON-RPC response
 * @returns {Boolean}
 */
export function isError(response) {
  return response?.error !== undefined;
}

/**
 * Extract error from JSON-RPC response
 * @param {Object} response - JSON-RPC response
 * @returns {Error}
 */
export function getError(response) {
  if (!isError(response)) {
    return null;
  }

  const error = response.error;
  const message = error.message || 'Unknown error';
  const code = error.code || -1;
  const data = error.data;

  const err = new Error(`JSON-RPC Error ${code}: ${message}`);
  err.code = code;
  err.data = data;
  return err;
}

/**
 * Extract result from JSON-RPC response
 * @param {Object} response - JSON-RPC response
 * @returns {*} Result data
 * @throws {Error} If response contains an error
 */
export function getResult(response) {
  if (isError(response)) {
    throw getError(response);
  }

  return response.result;
}
