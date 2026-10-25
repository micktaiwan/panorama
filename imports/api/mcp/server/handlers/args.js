// Argument checks for MCP tools/call, against the tool's declared inputSchema

/**
 * Return the argument names a closed schema (additionalProperties: false) does not declare.
 * Without this check, an unknown filter is silently dropped and the tool answers as if it
 * had been called with no filter at all (e.g. tool_tasksFilter returning every task).
 * @param {object} inputSchema - The tool's JSON schema
 * @param {object} args - The arguments sent by the client
 * @returns {string[]} Unknown argument names, empty when all are declared or the schema is open
 */
export function unknownArgs(inputSchema, args) {
  if (!inputSchema || inputSchema.additionalProperties !== false) return [];
  if (!args || typeof args !== 'object') return [];
  const known = Object.keys(inputSchema.properties || {});
  return Object.keys(args).filter(k => !known.includes(k));
}
