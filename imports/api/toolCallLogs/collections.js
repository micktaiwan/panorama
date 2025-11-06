import { Mongo } from 'meteor/mongo';

/**
 * Tool Call Logs Collection
 *
 * Tracks all MCP and Chat tool calls for observability, debugging, and analytics.
 * Follows best practices from "Building Smarter MCP Servers" (Clever Cloud blog).
 *
 * Schema:
 * {
 *   toolName: string - Name of the tool called (e.g., 'tool_tasksByProject')
 *   args: object - Arguments passed to the tool
 *   success: boolean - Whether the call succeeded
 *   error: string? - Error message if failed
 *   duration: number - Execution time in milliseconds
 *   resultSize: number - Size of the result in characters (for monitoring)
 *   source: string - Where the call came from ('mcp' | 'chat')
 *   timestamp: Date - When the call was made
 *   metadata: object? - Additional context (user agent, session, etc.)
 * }
 */
export const ToolCallLogsCollection = new Mongo.Collection('toolCallLogs');

// Indexes for common queries
if (Meteor.isServer) {
  Meteor.startup(() => {
    // Index for querying by tool name
    ToolCallLogsCollection.createIndexAsync({ toolName: 1, timestamp: -1 });

    // Index for querying recent calls (observability dashboard)
    ToolCallLogsCollection.createIndexAsync({ timestamp: -1 });

    // Index for detecting loops (same tool, recent timestamp)
    ToolCallLogsCollection.createIndexAsync({ toolName: 1, timestamp: -1, success: 1 });

    // TTL index: automatically delete logs older than 30 days to prevent bloat
    ToolCallLogsCollection.createIndexAsync(
      { timestamp: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );
  });
}
