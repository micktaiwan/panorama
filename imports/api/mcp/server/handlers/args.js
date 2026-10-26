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

/**
 * Build the error message for unknown arguments. When the client tried to pass ids
 * (ids, taskId, _id...) to a tool that does not take them, point to the generic by-id read,
 * since no per-collection "byId" tool exists for tasks, people, links...
 * @param {string} name - Tool name
 * @param {object} inputSchema - The tool's JSON schema
 * @param {string[]} unknown - Unknown argument names
 * @returns {string} Error message
 */
export function unknownArgsMessage(name, inputSchema, unknown) {
  const accepted = Object.keys(inputSchema?.properties || {});
  let msg = `Unknown argument(s) for ${name}: ${unknown.join(', ')}. Accepted: ${accepted.join(', ') || '(none)'}`;
  if (unknown.some(k => /^_?ids?$|Ids?$/.test(k))) {
    msg += '. To read documents by id, use tool_collectionQuery with {collection: "tasks", where: {_id: {in: ["<id>", ...]}}}';
  }
  return msg;
}
