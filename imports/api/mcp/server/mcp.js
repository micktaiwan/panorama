// MCP Server - JSON-RPC 2.0 Handler
// Implements Model Context Protocol for Panorama

import { PANORAMA_MCP_TOOLS } from './handlers/index';
import { callPanoramaTool } from './handlers/adapter';

// MCP Protocol version
const MCP_PROTOCOL_VERSION = '2024-11-05';

// JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

/**
 * Main handler for MCP JSON-RPC requests
 * @param {object} requestBody - JSON-RPC request body
 * @returns {Promise<object>} JSON-RPC response
 */
export async function handleMCPRequest(requestBody) {
  const startTime = Date.now();
  console.log('[mcp] Received request:', { method: requestBody?.method, id: requestBody?.id });

  try {
    // Validate JSON-RPC 2.0 format
    if (requestBody.jsonrpc !== '2.0') {
      return createError(
        requestBody.id || null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid JSON-RPC version. Expected "2.0"'
      );
    }

    if (!requestBody.method || typeof requestBody.method !== 'string') {
      return createError(
        requestBody.id || null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Missing or invalid "method" field'
      );
    }

    // Route to appropriate handler
    const { method, params, id } = requestBody;

    let result;
    switch (method) {
      case 'initialize':
        result = await handleInitialize(params);
        break;

      case 'tools/list':
        result = await handleToolsList(params);
        break;

      case 'tools/call':
        result = await handleToolsCall(params);
        break;

      default:
        return createError(
          id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Method not found: ${method}`
        );
    }

    const duration = Date.now() - startTime;
    console.log('[mcp] Request completed:', { method, duration: `${duration}ms` });

    return createSuccess(id, result);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[mcp] Request failed:', {
      duration: `${duration}ms`,
      error: error.message,
      stack: error.stack
    });

    return createError(
      requestBody?.id || null,
      JSON_RPC_ERRORS.INTERNAL_ERROR,
      error.message || 'Internal server error'
    );
  }
}

/**
 * Handle initialize method - MCP handshake
 */
async function handleInitialize(params) {
  console.log('[mcp] Initialize:', { params });

  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false // We don't support dynamic tool registration yet
      }
    },
    serverInfo: {
      name: 'Panorama MCP Server',
      version: '1.0.0'
    }
  };
}

/**
 * Handle tools/list method - List all available tools
 */
async function handleToolsList(params) {
  console.log('[mcp] Tools list requested');

  return {
    tools: PANORAMA_MCP_TOOLS
  };
}

/**
 * Handle tools/call method - Execute a specific tool
 */
async function handleToolsCall(params) {
  console.log('[mcp] Tool call:', { name: params?.name });

  // Validate params
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid params: expected object');
  }

  const { name, arguments: args } = params;

  if (!name || typeof name !== 'string') {
    throw new Error('Invalid or missing tool name');
  }

  // Verify tool exists
  const toolExists = PANORAMA_MCP_TOOLS.find(t => t.name === name);
  if (!toolExists) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Execute the tool via adapter
  const result = await callPanoramaTool(name, args || {});

  return result;
}

/**
 * Create a JSON-RPC 2.0 success response
 */
function createSuccess(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 */
function createError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  };
}

/**
 * Health check for MCP server
 */
export function getHealthStatus() {
  return {
    ok: true,
    protocol: MCP_PROTOCOL_VERSION,
    tools: PANORAMA_MCP_TOOLS.length,
    timestamp: new Date().toISOString()
  };
}
