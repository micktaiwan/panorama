# Panorama MCP Server

**Model Context Protocol** server for Panorama - exposes workspace tools to AI assistants.

## 🎯 Overview

The Panorama MCP server implements the **Model Context Protocol (MCP)** to expose Panorama's 20 workspace tools to AI assistants like Claude, Cursor, and other MCP-compatible clients.

### Architecture

```
┌─────────────────┐
│  AI Assistant   │ (Claude, Cursor, etc.)
└────────┬────────┘
         │ HTTP POST (JSON-RPC 2.0)
         │
┌────────▼────────────────────────────┐
│  MCP Server (/mcp endpoint)         │
│  - JSON-RPC 2.0 handler              │
│  - No authentication (localhost)     │
│  - CORS support                      │
└────────┬────────────────────────────┘
         │
┌────────▼────────────────────────────┐
│  Tool Handlers (21 tools)           │
│  - Reuses Panorama chat tools        │
│  - Direct Meteor collection access   │
└─────────────────────────────────────┘
```

### Protocol

- **Transport**: HTTP with JSON-RPC 2.0
- **Protocol Version**: `2024-11-05`
- **Authentication**: None (localhost only, single-user app)
- **Endpoints**:
  - `POST /mcp` - JSON-RPC endpoint
  - `GET /mcp/health` - Health check

## 🛠️ Available Tools (21)

All tools are exposed via MCP with `tool_*` prefix:

| Tool | Description | Required Params |
|------|-------------|----------------|
| `tool_listTools` | List all available tools | - |
| `tool_tasksFilter` | Filter tasks by any criteria | - |
| `tool_tasksByProject` | Tasks for a project | `projectId` |
| `tool_projectsList` | List all projects | - |
| `tool_projectByName` | Find project by name | `name` |
| `tool_semanticSearch` | Semantic search workspace | `query` |
| `tool_collectionQuery` | Generic collection query | `collection` |
| `tool_notesByProject` | Notes for a project | `projectId` |
| `tool_noteById` | Fetch a note with content & timestamps | `noteId` |
| `tool_noteSessionsByProject` | Note sessions for project | `projectId` |
| `tool_noteLinesBySession` | Lines in a note session | `sessionId` |
| `tool_linksByProject` | Links for a project | `projectId` |
| `tool_peopleList` | List all people | - |
| `tool_teamsList` | List all teams | - |
| `tool_filesByProject` | Files for a project | `projectId` |
| `tool_alarmsList` | List alarms/reminders | - |
| `tool_userLogsFilter` | Filter user logs by date | - |
| `tool_createTask` | Create a new task | `title` |
| `tool_updateTask` | Update an existing task | `taskId` |
| `tool_createNote` | Create a new note | `title` |
| `tool_updateNote` | Update an existing note | `noteId` |

See `/imports/api/tools/definitions.js` for detailed schemas.

## 🧪 Testing

### 1. Start Panorama

```bash
npm run dev:meteor
# or
meteor run --settings settings.json
```

Server runs on `http://localhost:3000` by default.

### 2. Test with MCP Inspector

Install and run MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Configure in the Inspector UI:
- **URL**: `http://localhost:3000/mcp`
- **Method**: POST
- **No authentication needed**

### 3. Test with curl

#### Health Check

```bash
curl http://localhost:3000/mcp/health
```

Expected response:
```json
{
  "ok": true,
  "protocol": "2024-11-05",
  "tools": 21,
  "timestamp": "2025-01-26T10:00:00.000Z"
}
```

#### Initialize (handshake)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {
        "listChanged": false
      }
    },
    "serverInfo": {
      "name": "Panorama MCP Server",
      "version": "1.0.0"
    }
  }
}
```

#### List Tools

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

Returns all 21 tools with descriptions and schemas.

#### Call a Tool

Example: List all projects

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "tool_projectsList",
      "arguments": {}
    }
  }'
```

Example: Find a project by name

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "tool_projectByName",
      "arguments": {
        "name": "MyProject"
      }
    }
  }'
```

Example: Semantic search

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "tool_semanticSearch",
      "arguments": {
        "query": "budget reports",
        "limit": 5
      }
    }
  }'
```

### 4. Automated Integration Tests

Run the full test suite:

```bash
./tests/mcp_integration.sh
```

This script automatically tests:
- ✅ Tool listing (21 tools with `tool_*` prefix)
- ✅ Read operations (`tool_tasksFilter`, `tool_projectsList`, `tool_noteById`)
- ✅ Write operations (`tool_createTask`, `tool_updateTask`)
- ✅ Filtering (`tool_tasksFilter` with parameters)

Expected output:
```
🧪 MCP Integration Tests (TDD)
================================

Test 1: List tools and verify tool_* prefix...
✅ Tools have correct prefix: tool_listTools
   Found 21 tools

Test 2: Call tool_tasksFilter...
✅ tool_tasksFilter returned 155 tasks

[... more tests ...]

================================
🎉 All 8 MCP integration tests passed!
```

**Requirements:**
- Panorama server must be running on `http://localhost:3000`
- `jq` command must be installed for JSON parsing

**All tests must pass before deploying.**

## 🔍 Logging

All MCP operations are logged with `[mcp]` prefix:

```
[mcp] HTTP routes registered: POST /mcp, GET /mcp/health
[mcp] Registry loaded: 21 tools available
[mcp] Received request: { method: 'tools/list', id: 2 }
[mcp] Tools list requested
[mcp] Request completed: { method: 'tools/list', duration: '5ms' }
```

Check server logs for debugging.

## 🔒 Security

- **No authentication**: Runs on localhost only, Panorama is single-user
- **Mixed tools**: 17 read-only tools + 4 write tools (`tool_createTask`, `tool_updateTask`, `tool_createNote`, `tool_updateNote`)
- **CORS enabled**: For web-based MCP clients
- **Local access only**: Bind to `127.0.0.1` in production

## 📦 Integration with Claude Desktop (Future)

To use with Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "panorama": {
      "command": "node",
      "args": [
        "/path/to/panorama/private/mcp/panorama-mcp-client.js"
      ],
      "env": {
        "PANORAMA_URL": "http://localhost:3000"
      }
    }
  }
}
```

Note: stdio transport client not yet implemented. Use HTTP with MCP Inspector for now.

## 🏗️ Architecture Details

### Files Structure

```
imports/api/mcp/
├── server/
│   ├── mcp.js              # JSON-RPC handler (initialize, tools/list, tools/call)
│   ├── routes.js           # WebApp route mounting (POST /mcp, GET /mcp/health)
│   └── handlers/
│       ├── index.js        # Registry (PANORAMA_MCP_TOOLS)
│       └── adapter.js      # Calls TOOL_HANDLERS from methods.js
└── doc/
    └── README.md           # This file
```

### How It Works

1. **Client sends JSON-RPC request** → `POST /mcp`
2. **routes.js parses JSON** → calls `handleMCPRequest()`
3. **mcp.js routes method**:
   - `initialize` → Returns capabilities
   - `tools/list` → Returns PANORAMA_MCP_TOOLS
   - `tools/call` → Delegates to adapter
4. **adapter.js calls handler** → `TOOL_HANDLERS[toolName](args, memory)`
5. **Handler queries Meteor collections** → Returns `{ output: '...' }`
6. **adapter transforms to MCP format** → `{ content: [{ type: 'text', text: '...' }] }`
7. **JSON-RPC response sent** → Client receives result

### Error Handling

- Parse errors → `-32700 Parse error`
- Method not found → `-32601 Method not found`
- Invalid params → `-32602 Invalid params`
- Tool execution errors → `-32603 Internal error` with error message in content

## 🚀 Next Steps

- [ ] Implement stdio transport for Claude Desktop
- [ ] Add request rate limiting
- [ ] Add tool call metrics/analytics
- [ ] Support streaming responses (for large result sets)
- [ ] Add optional API key authentication

## 📚 Resources

- [MCP Specification](https://modelcontextprotocol.io/docs)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification)
- Panorama tools: `/imports/api/chat/tools_helpers.js`

---

Built with ❤️ for Panorama
