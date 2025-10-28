// Registry of Panorama MCP tools
// Transforms TOOL_DEFINITIONS into MCP format

import { TOOL_DEFINITIONS } from '/imports/api/tools/definitions';

// Transform Panorama tools to MCP format
export const PANORAMA_MCP_TOOLS = TOOL_DEFINITIONS.map(tool => ({
  name: tool.name,
  description: tool.description || '',
  inputSchema: tool.parameters || {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
}));

// Log available tools at startup
console.log(`[mcp] Registry loaded: ${PANORAMA_MCP_TOOLS.length} tools available`);
