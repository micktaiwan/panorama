# MCP Tool Creation Guide

Quick reference for adding new tools to Panorama MCP server.

## 🎯 Overview

Tools are defined in two places:
1. **`/imports/api/tools/definitions.js`** - Tool schema (OpenAI function calling format)
2. **`/imports/api/tools/handlers.js`** - Tool implementation (async function)

Changes are **hot-reloaded** automatically by Meteor. No restart needed.

## ✅ Quick Steps

### Step 1: Add Tool Definition

Edit `/imports/api/tools/definitions.js` and add to the `TOOL_DEFINITIONS` array:

```javascript
{
  type: 'function',
  name: 'tool_yourToolName',
  description: 'Clear description of what the tool does. Used by AI to decide when to call it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      paramName: {
        type: 'string',
        description: 'Parameter description'
      },
      optionalParam: {
        type: 'number',
        description: 'Optional parameter'
      }
    },
    required: ['paramName']
  }
}
```

**Naming convention**: All tools must be prefixed with `tool_`

**Parameter types**: `string`, `number`, `boolean`, `object`, `array`

### Step 2: Add Tool Handler

Edit `/imports/api/tools/handlers.js` and add to the `TOOL_HANDLERS` object:

```javascript
async tool_yourToolName(args, memory) {
  // 1. Extract and validate arguments
  const paramName = String(args?.paramName || '').trim();
  if (!paramName) throw new Error('paramName is required');

  // 2. Perform the operation (read/write)
  const { YourCollection } = await import('/imports/api/yourResource/collections');
  const result = await YourCollection.findOneAsync({ _id: paramName });

  // OR call a Meteor method for write operations
  const id = await Meteor.callAsync('yourResource.insert', { paramName });

  // 3. Update working memory (optional, for chat context)
  if (memory) {
    memory.ids = memory.ids || {};
    memory.ids.yourResourceId = id;
  }

  // 4. Return JSON string output
  return { output: JSON.stringify({ result, id }) };
}
```

**Handler signature**: `async function(args, memory)`

**Return format**: `{ output: JSON.stringify(...) }`

**Error handling**: Throw errors with descriptive messages (logged by MCP adapter)

### Step 3: Test the Tool

Meteor hot-reloads automatically. Test immediately:

#### List tools to verify it's registered
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

#### Call your tool
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "tool_yourToolName",
      "arguments": {
        "paramName": "test-value"
      }
    }
  }'
```

## 📚 Complete Example: tool_createProject

### Definition (definitions.js)

```javascript
{
  type: 'function',
  name: 'tool_createProject',
  description: 'Create a new project with a name and optional description.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: {
        type: 'string',
        description: 'Project name (required)'
      },
      description: {
        type: 'string',
        description: 'Project description (optional)'
      },
      status: {
        type: 'string',
        description: 'Project status (optional, e.g., active, archived)'
      }
    },
    required: ['name']
  }
}
```

### Handler (handlers.js)

```javascript
async tool_createProject(args, memory) {
  // Validate required parameter
  const name = String(args?.name || '').trim();
  if (!name) throw new Error('name is required');

  // Build document with optional fields
  const doc = { name };
  if (args?.description) doc.description = String(args.description);
  if (args?.status) doc.status = String(args.status);

  // Call Meteor method
  const projectId = await Meteor.callAsync('projects.insert', doc);

  // Build result
  const result = { projectId, name, description: doc.description || null };

  // Update memory for chat context
  if (memory) {
    memory.ids = memory.ids || {};
    memory.ids.projectId = projectId;
    memory.entities = memory.entities || {};
    memory.entities.project = { name, description: doc.description || '' };
  }

  // Return JSON output
  return { output: JSON.stringify(result) };
}
```

### Test

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "tool_createProject",
      "arguments": {
        "name": "My New Project",
        "description": "Project description"
      }
    }
  }'
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"projectId\":\"abc123\",\"name\":\"My New Project\",\"description\":\"Project description\"}"
      }
    ]
  }
}
```

## 🔍 Pattern Categories

### Read-Only Tools

**Purpose**: Fetch data from collections

**Pattern**:
```javascript
async tool_getResource(args, memory) {
  const { ResourceCollection } = await import('/imports/api/resource/collections');
  const items = await ResourceCollection.find({}).fetchAsync();
  const mapped = items.map(i => ({ id: i._id, name: i.name }));

  if (memory) {
    memory.lists = memory.lists || {};
    memory.lists.resources = mapped;
  }

  return { output: JSON.stringify({ items: mapped, total: mapped.length }) };
}
```

**Examples**: `tool_projectsList`, `tool_tasksByProject`, `tool_notesByProject`

### Write Tools

**Purpose**: Create or update data

**Pattern**:
```javascript
async tool_createResource(args, memory) {
  const name = String(args?.name || '').trim();
  if (!name) throw new Error('name is required');

  const doc = { name };
  if (args?.description) doc.description = String(args.description);

  const id = await Meteor.callAsync('resource.insert', doc);

  if (memory) {
    memory.ids = memory.ids || {};
    memory.ids.resourceId = id;
  }

  return { output: JSON.stringify({ id, name }) };
}
```

**Examples**: `tool_createTask`, `tool_updateTask`, `tool_createNote`, `tool_createProject`

### Filter/Query Tools

**Purpose**: Filter collections with complex criteria

**Pattern**:
```javascript
async tool_filterResources(args, memory) {
  const { ResourceCollection } = await import('/imports/api/resource/collections');

  const selector = {};
  if (args?.status) selector.status = args.status;
  if (args?.dueBefore) selector.deadline = { $lte: new Date(args.dueBefore) };

  const items = await ResourceCollection.find(selector).fetchAsync();
  const mapped = items.map(i => ({ id: i._id, name: i.name }));

  if (memory) {
    memory.lists = memory.lists || {};
    memory.lists.resources = mapped;
  }

  return { output: JSON.stringify({ items: mapped, total: mapped.length }) };
}
```

**Examples**: `tool_tasksFilter`, `tool_collectionQuery`

### Semantic Search Tools

**Purpose**: Use Qdrant for semantic/vector search

**Pattern**:
```javascript
async tool_semanticSearch(args, memory) {
  const query = String(args?.query || '').trim();
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 8));

  // Get Qdrant client and embed query
  const url = getQdrantUrl();
  if (!url) return { output: JSON.stringify({ results: [], disabled: true }) };

  const { embedText } = await import('/imports/api/search/vectorStore');
  const vector = await embedText(query);

  const client = new QdrantClient({ url });
  const searchRes = await client.search('panorama', { vector, limit });

  const results = searchRes.map(r => ({
    kind: r.payload.kind,
    id: r.payload.docId,
    score: r.score
  }));

  if (memory) {
    memory.lists = memory.lists || {};
    memory.lists.searchResults = results;
  }

  return { output: JSON.stringify({ results, total: results.length }) };
}
```

**Examples**: `tool_semanticSearch`

## 💡 Best Practices

### Parameter Validation
```javascript
// Always validate required params
const name = String(args?.name || '').trim();
if (!name) throw new Error('name is required');

// Type coercion for safety
const limit = Math.max(1, Math.min(100, Number(args?.limit) || 10));
const enabled = typeof args?.enabled === 'boolean' ? args.enabled : true;
```

### Memory Management
```javascript
// Structure memory for chat context
if (memory) {
  // IDs for chaining tools
  memory.ids = memory.ids || {};
  memory.ids.resourceId = id;

  // Full entities for reference
  memory.entities = memory.entities || {};
  memory.entities.resource = { name, description };

  // Lists for batch operations
  memory.lists = memory.lists || {};
  memory.lists.resources = items;
}
```

### Output Format
```javascript
// Always return valid JSON string
return { output: JSON.stringify({
  // Include IDs for tool chaining
  id: result._id,
  // Include human-readable fields
  name: result.name,
  // Include metadata
  total: items.length,
  // Use null for missing optional fields (not undefined)
  description: result.description || null
}) };
```

### Error Handling
```javascript
// Throw descriptive errors
if (!name) throw new Error('name is required');
if (!projectId) throw new Error('projectId not found');

// Errors are automatically caught and formatted by MCP adapter
```

### Text Truncation
```javascript
// Use clampText helper for large fields
const clampText = (s, max = 300) => {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

// Apply to output
const mapped = items.map(i => ({
  id: i._id,
  title: clampText(i.title || ''),
  content: clampText(i.content || '', 500)
}));
```

## 🧪 Testing Checklist

- [ ] Tool appears in `tools/list` response
- [ ] Tool definition has `tool_` prefix
- [ ] Required parameters are enforced
- [ ] Optional parameters have defaults
- [ ] Output is valid JSON
- [ ] Memory is populated correctly
- [ ] Errors are descriptive
- [ ] Large text fields are truncated
- [ ] Tool works in MCP Inspector
- [ ] Tool works in Claude Code chat

## 📦 Integration

Tools are automatically exposed via:
1. **MCP Server** (`/mcp` endpoint) - For MCP clients like Claude Code
2. **Chat AI** (`/imports/api/chat/`) - For in-app chat assistant

No additional configuration needed. Add definition + handler = done.

## 🔗 Related Files

- `/imports/api/tools/definitions.js` - Tool schemas
- `/imports/api/tools/handlers.js` - Tool implementations
- `/imports/api/tools/helpers.js` - Shared helper functions
- `/imports/api/tools/schemas.js` - JSON Schema definitions
- `/imports/api/mcp/server/handlers/adapter.js` - MCP adapter
- `/imports/api/mcp/server/handlers/index.js` - MCP registry
- `/imports/api/mcp/doc/README.md` - MCP server documentation

## 📝 Summary

1. Add definition to `definitions.js`
2. Add handler to `handlers.js`
3. Test with `curl` or MCP Inspector
4. Done! Tool is available in MCP and Chat AI

---

Built with ❤️ for Panorama
