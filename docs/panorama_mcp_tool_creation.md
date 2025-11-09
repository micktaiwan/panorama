# Creating MCP Tools in Panorama

This guide explains how to add new tools to the Panorama MCP server.

## Overview

Panorama MCP tools are exposed via the Model Context Protocol and can be called by AI assistants like Claude. Each tool consists of:

1. **Tool Definition** - Schema and metadata (what the tool does)
2. **Tool Handler** - Implementation logic (how the tool works)

## File Structure

Two files need to be modified when adding a new tool:

```
imports/api/tools/
├── definitions.js    # Tool schemas and descriptions
└── handlers.js       # Tool implementations
```

## Step-by-Step Guide

### Step 1: Add Tool Definition

Open `imports/api/tools/definitions.js` and add your tool to the `TOOL_DEFINITIONS` array:

```javascript
{
  type: 'function',
  name: 'tool_myNewTool',
  description: 'Clear description of what this tool does. Use when the user wants to...',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      myParam: {
        type: 'string',
        description: 'Parameter description (required/optional)'
      },
      optionalParam: {
        type: 'number',
        description: 'Optional numeric parameter'
      }
    },
    required: ['myParam']  // List required parameters
  }
}
```

**Definition Guidelines:**
- Use descriptive `name` with `tool_` prefix
- Write clear `description` that helps AI know when to use it
- Document all parameters with helpful descriptions
- Mark required parameters explicitly

### Step 2: Implement Tool Handler

Open `imports/api/tools/handlers.js` and add your handler to the `TOOL_HANDLERS` object:

```javascript
async tool_myNewTool(args, memory) {
  // 1. Extract and validate parameters
  const myParam = String(args?.myParam || '').trim();
  if (!myParam) {
    return buildErrorResponse('myParam is required', 'tool_myNewTool', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide myParam parameter, e.g., {myParam: "value"}'
    });
  }

  try {
    // 2. Perform the operation
    const result = await Meteor.callAsync('myCollection.method', myParam);

    // 3. Update memory for tool chaining (optional)
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.myId = result.id;
    }

    // 4. Return structured success response
    return buildSuccessResponse(
      { data: result },
      'tool_myNewTool',
      { policy: 'write' }  // or 'read_only'
    );
  } catch (error) {
    return buildErrorResponse(error, 'tool_myNewTool');
  }
}
```

**Handler Guidelines:**
- Always validate required parameters
- Use `buildErrorResponse()` for errors with helpful suggestions
- Use `buildSuccessResponse()` for successful operations
- Set appropriate `policy`: `'write'` for mutations, `'read_only'` for queries
- Update `memory` for tool chaining if needed

## Response Format

All tools return structured responses following the Clever Cloud MCP best practices:

```json
{
  "data": { ... },           // Actual response data
  "summary": "...",          // Human-readable summary
  "metadata": {
    "source": "...",         // Data source (e.g., "panorama_db", "gmail")
    "policy": "...",         // Access policy ("read_only" or "write")
    "timestamp": "..."       // ISO timestamp
  }
}
```

## Complete Example: Delete Task Tool

### Definition in `definitions.js`

```javascript
{
  type: 'function',
  name: 'tool_deleteTask',
  description: 'Delete a task by ID. Use when the user wants to remove/delete a task permanently.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      taskId: { type: 'string', description: 'Task ID (required)' }
    },
    required: ['taskId']
  }
}
```

### Handler in `handlers.js`

```javascript
async tool_deleteTask(args, memory) {
  const taskId = String(args?.taskId || '').trim();
  if (!taskId) {
    return buildErrorResponse('taskId is required', 'tool_deleteTask', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide taskId parameter'
    });
  }

  try {
    await Meteor.callAsync('tasks.remove', taskId);

    const result = { deleted: true, taskId };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.taskId = taskId;
    }

    return buildSuccessResponse(result, 'tool_deleteTask', { policy: 'write' });
  } catch (error) {
    return buildErrorResponse(error, 'tool_deleteTask');
  }
}
```

## Testing Your Tool

### Via curl (HTTP MCP)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "tool_deleteTask",
      "arguments": {
        "taskId": "abc123"
      }
    }
  }'
```

### Via Claude Desktop

After restarting the Panorama server, your tool will be available to Claude:

```
User: "Delete the test task abc123"
Claude: [Uses tool_deleteTask with taskId: "abc123"]
```

## Best Practices

### 1. Parameter Validation

Always validate required parameters and provide helpful error messages:

```javascript
if (!requiredParam) {
  return buildErrorResponse('requiredParam is required', 'tool_name', {
    code: 'MISSING_PARAMETER',
    suggestion: 'Provide requiredParam, e.g., {requiredParam: "value"}'
  });
}
```

### 2. Error Handling

Use try/catch for operations that may fail:

```javascript
try {
  const result = await Meteor.callAsync('method', args);
  return buildSuccessResponse(result, 'tool_name');
} catch (error) {
  return buildErrorResponse(error, 'tool_name');
}
```

### 3. Memory Updates

Update memory to enable tool chaining:

```javascript
if (memory) {
  memory.ids = memory.ids || {};
  memory.ids.projectId = projectId;
  memory.entities = memory.entities || {};
  memory.entities.project = { name, description };
}
```

### 4. Appropriate Policy

Set the correct policy in metadata:

- `policy: 'write'` - For create/update/delete operations
- `policy: 'read_only'` - For read-only queries

### 5. Data Sanitization

Clamp long text fields to avoid bloated responses:

```javascript
const clampText = (s, max = 300) => {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

// Usage
const mapped = tasks.map(t => ({
  id: t._id,
  title: clampText(t.title || ''),
  notes: clampText(t.notes || '')
}));
```

## Common Patterns

### Read-Only Query Tool

```javascript
async tool_queryItems(args, memory) {
  const { ItemsCollection } = await import('/imports/api/items/collections');
  const items = await ItemsCollection.find({}).fetchAsync();

  const mapped = items.map(i => ({ id: i._id, name: i.name }));

  if (memory) {
    memory.lists = memory.lists || {};
    memory.lists.items = mapped;
  }

  return buildSuccessResponse(
    { items: mapped, total: mapped.length },
    'tool_queryItems'
  );
}
```

### Create Tool

```javascript
async tool_createItem(args, memory) {
  const name = String(args?.name || '').trim();
  if (!name) {
    return buildErrorResponse('name is required', 'tool_createItem', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide name parameter'
    });
  }

  const itemId = await Meteor.callAsync('items.insert', { name });

  if (memory) {
    memory.ids = memory.ids || {};
    memory.ids.itemId = itemId;
  }

  return buildSuccessResponse(
    { itemId, name },
    'tool_createItem',
    { policy: 'write' }
  );
}
```

### Update Tool

```javascript
async tool_updateItem(args, memory) {
  const itemId = String(args?.itemId || '').trim();
  if (!itemId) {
    return buildErrorResponse('itemId is required', 'tool_updateItem', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide itemId parameter'
    });
  }

  const modifier = {};
  if (args?.name) modifier.name = String(args.name);
  if (args?.description) modifier.description = String(args.description);

  if (Object.keys(modifier).length === 0) {
    return buildErrorResponse('No fields to update', 'tool_updateItem', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide at least one field to update'
    });
  }

  await Meteor.callAsync('items.update', itemId, modifier);

  return buildSuccessResponse(
    { updated: true, itemId },
    'tool_updateItem',
    { policy: 'write' }
  );
}
```

### Delete Tool

```javascript
async tool_deleteItem(args, memory) {
  const itemId = String(args?.itemId || '').trim();
  if (!itemId) {
    return buildErrorResponse('itemId is required', 'tool_deleteItem', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide itemId parameter'
    });
  }

  try {
    await Meteor.callAsync('items.remove', itemId);

    return buildSuccessResponse(
      { deleted: true, itemId },
      'tool_deleteItem',
      { policy: 'write' }
    );
  } catch (error) {
    return buildErrorResponse(error, 'tool_deleteItem');
  }
}
```

## Tool Chaining with Memory

Memory allows tools to pass data between calls. This enables efficient workflows:

```javascript
// Tool 1: Find project by name
async tool_projectByName(args, memory) {
  const proj = await ProjectsCollection.findOneAsync({ name: args.name });

  if (memory && proj) {
    memory.ids = memory.ids || {};
    memory.ids.projectId = proj._id;  // Store for next tool
  }

  return buildSuccessResponse({ project: proj }, 'tool_projectByName');
}

// Tool 2: Get tasks using stored projectId
async tool_tasksByProject(args, memory) {
  const projectId = args?.projectId || memory?.ids?.projectId;  // Use from memory
  const tasks = await TasksCollection.find({ projectId }).fetchAsync();

  return buildSuccessResponse({ tasks }, 'tool_tasksByProject');
}
```

## Observability

All tool calls are automatically logged to the `toolCallLogs` collection with:
- Tool name
- Arguments
- Success/failure status
- Duration (ms)
- Result size
- Timestamp

This enables monitoring and debugging:

```javascript
// Find recent failures
db.toolCallLogs.find({ success: false }).sort({ timestamp: -1 })

// Find slowest tools
db.toolCallLogs.find().sort({ duration: -1 }).limit(10)
```

## Infinite Loop Protection

The MCP server automatically detects infinite loops:
- **Threshold:** 5 identical tool calls within 10 seconds
- **Action:** Throws `RATE_LIMIT_EXCEEDED` error
- **Auto-reset:** Window clears after 10 seconds

## MCP-First Philosophy

**Always use MCP tools as your first and primary interface to Panorama data.** Before reaching for direct database access (bash, mongosh, meteor shell), exhaust all MCP options.

### Why MCP Over Direct Access?

1. **Observability**: All MCP calls are logged to `toolCallLogs` with timing, success/failure, and parameters
2. **Consistency**: Structured responses with `{data, summary, metadata}` format
3. **Safety**: Parameter validation, error handling, and infinite loop protection built-in
4. **Evolution**: MCP tools evolve with the codebase; direct queries don't

### Anti-Pattern: Bypassing MCP

❌ **DON'T** bypass MCP when a query doesn't return expected results:

```bash
# Wrong approach: jumping to bash/mongosh
User: "List tasks with deadlines"
Assistant: [Calls tool_collectionQuery, gets unexpected results]
Assistant: "Let me use mongosh to query the database directly..."
mongosh panorama --eval "db.tasks.find({deadline: {$ne: null}})"
```

✅ **DO** try different MCP tools or parameters:

```javascript
// Correct approach: exhaust MCP options first
User: "List tasks with deadlines"
Assistant: [Calls tool_collectionQuery with basic query]
Assistant: "The query didn't filter correctly. Let me refine the parameters..."
Assistant: [Calls tool_tasksFilter with proper where clause]
// OR
Assistant: [Calls tool_collectionQuery with improved DSL query]
// OR
Assistant: "Let me check if there's a pre-configured query helper..."
Assistant: [Uses COMMON_QUERIES.tasksWithDeadline via tool_collectionQuery]
```

### When MCP Feels Insufficient

Follow this escalation workflow:

1. **Retry with different parameters**: The same tool often works with refined arguments
   - Check the response metadata `hint` for suggestions
   - Review `COMMON_QUERIES` in `helpers.js` for pre-tested patterns
   - Try related tools (e.g., `tool_tasksFilter` instead of `tool_collectionQuery`)

2. **Check if a specialized tool exists**: Browse `definitions.js` for domain-specific tools
   - `tool_tasksByProject` for project-scoped tasks
   - `tool_tasksFilter` for complex filtering
   - `tool_semanticSearch` for natural language queries

3. **Consider creating a new tool**: If no tool fits your need, the MCP API is incomplete
   - Follow this guide to create a specialized tool
   - Add to both `definitions.js` and `handlers.js`
   - Test and document the new tool

> **Remember**: If you need direct database access, it means the MCP API is incomplete. Fix the API by creating a proper tool, don't bypass it with one-off queries.

### Real-World Example: Task Filtering

**Scenario**: List all tasks with deadlines, ordered by deadline ascending.

**Wrong approach** (bypassing MCP):
```bash
# Jumping directly to mongosh
mongosh panorama --eval "db.tasks.find({deadline: {$ne: null}}).sort({deadline: 1})"
```

**Correct approach** (MCP-first):
```javascript
// Step 1: Try tool_collectionQuery
tool_collectionQuery({
  collection: 'tasks',
  where: { deadline: { ne: null } },
  sort: { deadline: 1 }
})

// Step 2: If that doesn't work, try tool_tasksFilter
tool_tasksFilter({
  status: 'todo',
  // ... use specialized parameters
})

// Step 3: Check COMMON_QUERIES for pre-tested patterns
// The response metadata might suggest: "use COMMON_QUERIES.tasksWithDeadline"
tool_collectionQuery({
  collection: 'tasks',
  where: COMMON_QUERIES.tasksWithDeadline.where,
  sort: COMMON_QUERIES.tasksWithDeadline.sort
})
```

### Benefits of MCP-First

- **Debugging**: Failed queries are logged with full context in `toolCallLogs`
- **Rate limiting**: Automatic protection against infinite loops
- **Memory**: Tool chaining works seamlessly with the memory object
- **Type safety**: Parameter schemas validate inputs before execution
- **Future-proof**: When the database schema changes, update the tool handler, not scattered queries

## Related Documentation

- `docs/mcp-email-tools.md` - Email tool examples
- `docs/mcp-agents.md` - Agent architecture and integration
- `imports/api/tools/responseBuilder.js` - Response formatting utilities
- `imports/api/tools/helpers.js` - Query building utilities

## Troubleshooting

### Tool not appearing in Claude

1. Check that the tool is added to both `definitions.js` and `handlers.js`
2. Restart the Panorama server (`meteor` command)
3. Verify MCP endpoint is accessible: `http://localhost:3000/mcp`

### Tool returns errors

1. Check server logs for detailed error messages
2. Verify parameter validation logic
3. Test the underlying Meteor method directly
4. Check `toolCallLogs` collection for error details

### Tool works but response is malformed

1. Ensure you're using `buildSuccessResponse()` and `buildErrorResponse()`
2. Check that data is properly serialized (no circular references)
3. Verify parameter types match the schema

## Summary

Creating a new MCP tool requires:

1. ✅ Add definition to `definitions.js` with clear description and schema
2. ✅ Implement handler in `handlers.js` with validation and error handling
3. ✅ Use `buildSuccessResponse()` and `buildErrorResponse()` for consistency
4. ✅ Set appropriate policy (`write` or `read_only`)
5. ✅ Test via curl or Claude Desktop
6. ✅ Update memory for tool chaining if needed

Following these patterns ensures your tools are reliable, observable, and easy to use.
