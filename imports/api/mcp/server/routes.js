// MCP Server - HTTP Routes Configuration
// Mounts MCP endpoints on Meteor WebApp

import { WebApp } from 'meteor/webapp';
import { handleMCPRequest, getHealthStatus } from './mcp';

// CORS headers for cross-origin requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * Set CORS headers on response
 */
function setCorsHeaders(res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

/**
 * Parse JSON request body
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * GET /mcp/health - Health check endpoint (must be registered BEFORE /mcp)
 */
WebApp.connectHandlers.use('/mcp/health', (req, res, _next) => {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }

  try {
    const health = getHealthStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  } catch (error) {
    console.error('[mcp] Health check failed:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

/**
 * POST /mcp - Main MCP JSON-RPC endpoint
 */
WebApp.connectHandlers.use('/mcp', async (req, res, next) => {
  // Skip if this is a sub-path (e.g., /mcp/health)
  // req.url in connect middleware is the path AFTER the mount point
  // So when mounted at '/mcp', req.url will be '/' or '/something'
  if (req.url !== '/') {
    return next();
  }

  // Set CORS headers
  setCorsHeaders(res);

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Only allow POST for JSON-RPC
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    return;
  }

  try {
    // Parse JSON body
    const requestBody = await parseJsonBody(req);

    // Handle JSON-RPC request
    const response = await handleMCPRequest(requestBody);

    // Send response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

  } catch (error) {
    console.error('[mcp] Request handling failed:', error);

    // Send JSON-RPC parse error
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700, // Parse error
        message: `Parse error: ${error.message}`
      }
    }));
  }
});

console.log('[mcp] HTTP routes registered: POST /mcp, GET /mcp/health');
