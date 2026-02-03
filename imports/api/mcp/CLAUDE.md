# Panorama MCP Server

## Local Development

The MCP server runs on **port 4000** (same as Meteor app).

- **Endpoint**: `http://localhost:4000/mcp`
- **Health check**: `http://localhost:4000/mcp/health`
- **Protocol**: JSON-RPC 2.0

## Testing with curl

```bash
# Health check
curl http://localhost:4000/mcp/health

# List tools
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'

# Call a tool
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"tool_projectsList","arguments":{}},"id":1}'
```

## Structure

- `server/routes.js` - HTTP endpoint setup
- `server/mcp.js` - JSON-RPC handler
- `server/handlers/` - Tool adapters
- `../tools/` - Tool definitions, handlers, and helpers
