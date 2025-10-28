// Adapter to call Panorama tool handlers from MCP

import { TOOL_HANDLERS } from '/imports/api/tools/handlers';

/**
 * Execute a Panorama tool and return MCP-formatted result
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Tool arguments (optional)
 * @returns {Promise<object>} MCP-formatted result with content array
 */
export async function callPanoramaTool(toolName, args = {}) {
  const startTime = Date.now();
  console.log(`[mcp] Calling tool: ${toolName}`, { args });

  try {
    // Verify tool exists
    const handler = TOOL_HANDLERS[toolName];
    if (!handler) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Create empty working memory (handlers will populate as needed)
    const workingMemory = {
      ids: {},
      entities: {},
      lists: {},
      params: {}
    };

    // Call the handler directly (handlers are async functions)
    const result = await handler(args, workingMemory);

    // Transform to MCP format
    const mcpResult = {
      content: [
        {
          type: 'text',
          text: result.output || '{}'
        }
      ]
    };

    const duration = Date.now() - startTime;
    console.log(`[mcp] Tool completed: ${toolName}`, { duration: `${duration}ms` });

    return mcpResult;

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[mcp] Tool failed: ${toolName}`, {
      duration: `${duration}ms`,
      error: error.message,
      stack: error.stack
    });

    // Return error in MCP format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message || String(error),
            tool: toolName
          })
        }
      ],
      isError: true
    };
  }
}
