// AsyncLocalStorage for MCP request-scoped userId
// Avoids refactoring all 46 tool handlers in handlers.js

import { AsyncLocalStorage } from 'async_hooks';

export const mcpRequestContext = new AsyncLocalStorage();

/**
 * Get the userId from the current MCP request context.
 * Returns undefined if not inside a request context.
 */
export function getMCPRequestUserId() {
  return mcpRequestContext.getStore()?.userId;
}
