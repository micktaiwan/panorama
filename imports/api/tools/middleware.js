// Tool middleware for logging, rate limiting, and observability
// Implements best practices from "Building Smarter MCP Servers" (Clever Cloud)

import { Meteor } from 'meteor/meteor';
import { ToolCallLogsCollection } from '/imports/api/toolCallLogs/collections';

/**
 * In-memory cache for loop detection
 * Structure: Map<toolName, Array<timestamp>>
 * Automatically cleaned every 60 seconds
 */
const RECENT_CALLS = new Map();
const LOOP_DETECTION_WINDOW_MS = 2000; // 2 seconds
const LOOP_DETECTION_THRESHOLD = 10; // Max 10 identical calls in window

// Cleanup old entries every 60 seconds
if (Meteor.isServer) {
  Meteor.setInterval(() => {
    const now = Date.now();
    for (const [toolName, timestamps] of RECENT_CALLS.entries()) {
      const recent = timestamps.filter(ts => now - ts < LOOP_DETECTION_WINDOW_MS);
      if (recent.length === 0) {
        RECENT_CALLS.delete(toolName);
      } else {
        RECENT_CALLS.set(toolName, recent);
      }
    }
  }, 60000);
}

/**
 * Detect potential infinite loops
 * Throws error if same tool called more than threshold times in window
 *
 * @param {string} toolName - Name of the tool being called
 * @throws {Error} If loop detected
 */
export function detectInfiniteLoop(toolName) {
  const now = Date.now();

  // Get recent calls for this tool
  const timestamps = RECENT_CALLS.get(toolName) || [];

  // Filter to only calls within the detection window
  const recentTimestamps = timestamps.filter(
    ts => now - ts < LOOP_DETECTION_WINDOW_MS
  );

  // Check if threshold exceeded
  if (recentTimestamps.length >= LOOP_DETECTION_THRESHOLD) {
    const error = new Error(
      `Rate limit exceeded: tool "${toolName}" called ${recentTimestamps.length} times in ${LOOP_DETECTION_WINDOW_MS / 1000} seconds ` +
      `(max ${LOOP_DETECTION_THRESHOLD} calls per ${LOOP_DETECTION_WINDOW_MS / 1000}s). ` +
      `Please wait a moment before retrying or reduce the number of calls.`
    );
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.toolName = toolName;
    error.callCount = recentTimestamps.length;
    throw error;
  }

  // Record this call
  recentTimestamps.push(now);
  RECENT_CALLS.set(toolName, recentTimestamps);
}

/**
 * Log tool call to MongoDB for observability
 *
 * @param {string} toolName - Name of the tool
 * @param {object} args - Arguments passed to the tool
 * @param {boolean} success - Whether the call succeeded
 * @param {string|null} error - Error message if failed
 * @param {number} duration - Execution time in ms
 * @param {number} resultSize - Size of result in characters
 * @param {string} source - Source of the call ('mcp' or 'chat')
 * @returns {Promise<string>} Log ID
 */
export async function logToolCall({
  toolName,
  args,
  success,
  error = null,
  duration,
  resultSize,
  source = 'mcp',
  metadata = {}
}) {
  try {
    const logDoc = {
      toolName,
      args: args || {},
      success,
      error: error ? String(error) : null,
      duration: Number(duration) || 0,
      resultSize: Number(resultSize) || 0,
      source: String(source),
      timestamp: new Date(),
      metadata
    };

    const logId = await ToolCallLogsCollection.insertAsync(logDoc);

    // Console log for immediate debugging (structured JSON)
    console.log('[tool-call]', JSON.stringify({
      toolName,
      success,
      duration: `${duration}ms`,
      resultSize,
      error: error ? String(error).substring(0, 100) : null
    }));

    return logId;
  } catch (logError) {
    // Never fail the actual tool call because of logging failure
    console.error('[middleware] Failed to log tool call:', logError);
    return null;
  }
}

/**
 * Wrap a tool handler with middleware (logging + loop detection)
 *
 * Usage:
 *   const wrappedHandler = wrapToolHandler('tool_tasksByProject', originalHandler);
 *
 * @param {string} toolName - Name of the tool
 * @param {Function} handler - Original tool handler function
 * @param {string} source - Source of the call ('mcp' or 'chat')
 * @returns {Function} Wrapped handler
 */
export function wrapToolHandler(toolName, handler, source = 'mcp') {
  return async function wrappedHandler(args, memory) {
    const startTime = Date.now();
    let success = false;
    let error = null;
    let result = null;
    try {
      // 1. Check for infinite loops
      detectInfiniteLoop(toolName);

      // 2. Execute the actual handler
      result = await handler(args, memory);
      success = true;

      return result;

    } catch (err) {
      success = false;
      error = err.message || 'Unknown error';
      throw err; // Re-throw to preserve error handling

    } finally {
      // 3. Log the call (always, even if it failed)
      const duration = Date.now() - startTime;
      const resultSize = result?.output ? String(result.output).length : 0;

      await logToolCall({
        toolName,
        args,
        success,
        error,
        duration,
        resultSize,
        source,
        metadata: {
          memoryKeys: memory ? Object.keys(memory) : []
        }
      });
    }
  };
}

/**
 * Get recent tool call statistics for observability dashboard
 *
 * @param {number} minutes - Look back window in minutes (default: 60)
 * @returns {Promise<object>} Statistics object
 */
export async function getToolCallStats(minutes = 60) {
  const cutoffDate = new Date(Date.now() - minutes * 60 * 1000);

  const logs = await ToolCallLogsCollection.find(
    { timestamp: { $gte: cutoffDate } },
    { fields: { toolName: 1, success: 1, duration: 1 } }
  ).fetchAsync();

  const stats = {
    totalCalls: logs.length,
    successRate: logs.filter(l => l.success).length / logs.length,
    byTool: {},
    avgDuration: logs.reduce((sum, l) => sum + (l.duration || 0), 0) / logs.length
  };

  // Group by tool
  for (const log of logs) {
    if (!stats.byTool[log.toolName]) {
      stats.byTool[log.toolName] = { calls: 0, errors: 0, avgDuration: 0 };
    }
    stats.byTool[log.toolName].calls += 1;
    if (!log.success) stats.byTool[log.toolName].errors += 1;
    stats.byTool[log.toolName].avgDuration += log.duration || 0;
  }

  // Calculate averages
  for (const toolName of Object.keys(stats.byTool)) {
    const tool = stats.byTool[toolName];
    tool.avgDuration = tool.avgDuration / tool.calls;
  }

  return stats;
}
