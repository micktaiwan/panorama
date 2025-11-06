# Panorama MCP Server

This document describes the Panorama MCP server, its tools, and enhancements.

## Overview

The Panorama MCP server exposes all Panorama functionality via the Model Context Protocol, allowing AI assistants like Claude to interact with tasks, projects, notes, and emails.

**Enhanced with production-ready features:**
- ✅ Human-readable summaries in all responses
- ✅ Structured error messages with suggestions
- ✅ Infinite loop detection (max 5 calls/10s per tool)
- ✅ Complete observability (all calls logged to MongoDB)
- ✅ Metadata tracking (source, policy, timestamps)

## Email Tools

The email tools allow MCP clients to interact with the Gmail cache in Panorama:

1. **Updating the email cache** from Gmail
2. **Searching** through cached emails
3. **Reading** full email content

## Prerequisites

- Gmail must be connected in Panorama (Preferences → Gmail)
- Panorama server must be running on `http://localhost:3000`
- MCP endpoint is available at `http://localhost:3000/mcp`

## Tools

### 1. tool_emailsUpdateCache

Updates the local email cache by fetching new messages from Gmail.

**Description:** Update the local email cache by fetching new messages from Gmail. Use when the user asks to refresh/sync/update their emails or check for new messages.

**Parameters:**
```json
{
  "maxResults": 20  // Optional: Maximum number of emails to fetch (default: 20, max: 100)
}
```

**Response:**
```json
{
  "success": true,
  "totalMessages": 42,
  "newMessages": 5,
  "successCount": 5,
  "errorCount": 0
}
```

**Example MCP Call:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "tool_emailsUpdateCache",
    "arguments": {
      "maxResults": 50
    }
  }
}
```

---

### 2. tool_emailsSearch

Search through cached emails using text search or semantic search.

**Description:** Search through cached emails using Gmail query syntax or semantic search. Use when the user wants to find emails by sender, subject, content, or date range.

**Parameters:**
```json
{
  "query": "from:john@example.com",  // Required: Search query
  "limit": 10,                        // Optional: Max results (default: 10, max: 50)
  "useSemanticSearch": false          // Optional: Use vector search (default: false)
}
```

**Search Methods:**

1. **Text Search (default):** Supports Gmail query syntax and regex matching
2. **Semantic Search:** Uses Qdrant vector search for meaning-based matching

**Gmail Query Syntax (Text Search):**

Supported operators:
- `is:unread` - Find unread emails
- `is:read` - Find read emails
- `is:starred` - Find starred emails
- `is:important` - Find important emails
- `is:inbox` - Find emails in inbox
- `is:trash` - Find trashed emails
- `from:sender` - Find emails from specific sender (e.g., `from:john@example.com`)
- `subject:text` - Find emails with text in subject
- Any other text - Full-text search in from, subject, snippet, and body

**Response:**
```json
{
  "emails": [
    {
      "id": "gmail_message_id",
      "mongoId": "mongodb_object_id",
      "from": "John Doe <john@example.com>",
      "subject": "Meeting Tomorrow",
      "snippet": "Hi, let's meet tomorrow at 2pm...",
      "date": "2025-01-27T10:30:00.000Z",
      "labels": ["INBOX", "UNREAD"]
    }
  ],
  "total": 5,
  "query": "from:john@example.com",
  "method": "text"
}
```

**Example Queries:**

Gmail query syntax:
- `"is:unread"` - Find all unread emails
- `"is:starred"` - Find starred emails
- `"from:john@example.com"` - Find emails from John
- `"subject:invoice"` - Find emails with "invoice" in subject
- `"meeting"` - Full-text search for "meeting"

Semantic search (requires Qdrant):
```json
{
  "query": "emails about project deadlines and deliverables",
  "useSemanticSearch": true,
  "limit": 20
}
```

---

### 3. tool_emailsRead

Read the full content of one or more emails by their ID.

**Description:** Read the full content of one or more emails by their ID. Use when the user wants to see the complete message body and details.

**Parameters:**
```json
{
  "emailIds": ["id1", "id2"],  // Required: Array of email IDs (Gmail ID or MongoDB _id)
  "includeThread": false        // Optional: Include all thread messages (default: false)
}
```

**Response:**
```json
{
  "emails": [
    {
      "id": "gmail_message_id",
      "mongoId": "mongodb_object_id",
      "threadId": "thread_id",
      "from": "John Doe <john@example.com>",
      "to": "me@example.com",
      "subject": "Meeting Tomorrow",
      "snippet": "Hi, let's meet tomorrow at 2pm...",
      "body": "Hi,\n\nLet's meet tomorrow at 2pm to discuss the project.\n\nBest,\nJohn",
      "date": "2025-01-27T10:30:00.000Z",
      "labels": ["INBOX", "UNREAD"],
      "threadMessages": []  // Populated if includeThread=true
    }
  ],
  "total": 1,
  "includeThread": false
}
```

**Example with Thread:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tool_emailsRead",
    "arguments": {
      "emailIds": ["gmail_message_id"],
      "includeThread": true
    }
  }
}
```

When `includeThread` is true, `threadMessages` array contains all messages in the conversation thread.

---

## Usage Examples

### Typical Workflow

1. **Update cache to get latest emails:**
   ```bash
   curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -d '{
     "jsonrpc": "2.0",
     "id": 1,
     "method": "tools/call",
     "params": {
       "name": "tool_emailsUpdateCache",
       "arguments": { "maxResults": 50 }
     }
   }'
   ```

2. **Search for specific emails:**
   ```bash
   curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -d '{
     "jsonrpc": "2.0",
     "id": 2,
     "method": "tools/call",
     "params": {
       "name": "tool_emailsSearch",
       "arguments": { "query": "invoice", "limit": 10 }
     }
   }'
   ```

3. **Read full email content:**
   ```bash
   # Use email ID from search results
   curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -d '{
     "jsonrpc": "2.0",
     "id": 3,
     "method": "tools/call",
     "params": {
       "name": "tool_emailsRead",
       "arguments": { "emailIds": ["email_id_from_search"] }
     }
   }'
   ```

### Integration with Claude Desktop

Add to Claude Desktop's MCP configuration:

```json
{
  "mcpServers": {
    "panorama": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Then you can ask Claude:
- "Can you update my email cache?"
- "Search for emails from john@example.com"
- "Read the full content of email ID xyz123"
- "Find emails about project deadlines using semantic search"

---

## Technical Notes

### Email Storage

- Emails are cached locally in MongoDB (`gmailMessages` collection)
- Gmail API is only called during cache updates
- Searches operate on the cached data for fast response

### Semantic Search Requirements

- Requires Qdrant to be configured and running
- Emails must be vectorized (happens automatically during cache update)
- Uses the same embedding model as configured in Preferences → AI
- Collection filter: `kind: 'email'`

### Enhanced Response Format

All tools now return **structured responses** with three components:

```json
{
  "data": { ... },           // The actual data
  "summary": "...",          // Human-readable summary
  "metadata": {
    "source": "gmail_cache",  // Data source
    "policy": "read_only",    // Access policy
    "timestamp": "..."        // When generated
  }
}
```

**Example - tool_emailsSearch:**
```json
{
  "data": {
    "emails": [...],
    "total": 5,
    "query": "from:john@example.com",
    "method": "text"
  },
  "summary": "Found 5 emails using text search",
  "metadata": {
    "source": "gmail_cache",
    "policy": "read_only",
    "timestamp": "2025-01-28T10:30:00.000Z"
  }
}
```

### Error Handling

All tools return **structured error responses** with helpful suggestions:

```json
{
  "error": {
    "code": "MISSING_PARAMETER",
    "message": "query is required",
    "tool": "tool_emailsSearch",
    "timestamp": "2025-01-28T10:30:00.000Z",
    "suggestion": "Provide a search query, e.g., {query: \"from:sender@example.com\"}"
  }
}
```

Common error codes:
- `MISSING_PARAMETER` - Required parameter not provided
- `INVALID_COLLECTION` - Unknown collection name
- `SERVICE_UNAVAILABLE` - External service (Qdrant, Gmail) unavailable
- `RATE_LIMIT_EXCEEDED` - Infinite loop detected

### Observability & Monitoring

All tool calls are automatically logged to the `toolCallLogs` collection:

```javascript
{
  toolName: 'tool_emailsSearch',
  args: { query: 'invoice', limit: 10 },
  success: true,
  error: null,
  duration: 234,            // milliseconds
  resultSize: 1523,         // characters
  source: 'mcp',           // 'mcp' or 'chat'
  timestamp: Date,
  metadata: {}
}
```

**Automatic cleanup:** Logs older than 30 days are automatically deleted (TTL index).

**Query examples:**
```javascript
// Get recent failures
db.toolCallLogs.find({ success: false }).sort({ timestamp: -1 }).limit(10)

// Get slowest tools
db.toolCallLogs.find().sort({ duration: -1 }).limit(10)

// Get most used tools
db.toolCallLogs.aggregate([
  { $group: { _id: '$toolName', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])
```

### Infinite Loop Protection

The server automatically detects potential infinite loops:
- **Threshold:** 5 identical tool calls within 10 seconds
- **Action:** Throws `RATE_LIMIT_EXCEEDED` error
- **Auto-reset:** Window clears after 10 seconds

Example error:
```
Infinite loop detected: tool "tool_projectsList" called 5 times in 10 seconds.
This usually indicates an agent loop. Please check your tool call logic.
```

---

## Implementation Details

### Files Modified

- `imports/api/tools/definitions.js` - Tool definitions
- `imports/api/tools/handlers.js` - Tool handlers

### Dependencies

- `imports/api/emails/collections.js` - Email collections
- `imports/api/emails/methods.js` - Gmail API methods
- `imports/api/search/vectorStore.js` - Vector search (for semantic search)

### Collections Used

- `GmailMessagesCollection` - Cached email messages
- Qdrant collection (for vector search)

---

## Testing

### Test All MCP Improvements

Run the comprehensive test suite:

```bash
# Make sure Panorama server is running first
npm start

# In another terminal:
node test-mcp-improvements.js
```

Expected output:
```
🧪 Testing MCP Improvements

📝 Testing structured response for tool_projectsList...
✅ tool_projectsList returns structured response
   Summary: "Found 5 projects"
   Source: panorama_db
   Policy: read_only

📝 Testing structured response for tool_listTools...
✅ tool_listTools returns structured response
   Summary: "Available: 26 tools"
   Source: panorama_server
   Policy: read_only

🔄 Testing infinite loop detection...
   Waiting 11s for rate limit window to clear...
✅ Loop detection works correctly
   Error message: "Infinite loop detected: tool "tool_projectsList" called 5 times..."

📊 Testing tool call logging...
✅ Tool call logs are being created (42 logs found)

❌ Testing error response format...
✅ Error responses are structured correctly
   Code: MISSING_PARAMETER
   Message: "name is required"
   Suggestion: "Provide a project name, e.g., {name: \"My Project\"}"

✅ All tests passed!
```

### Test Email Tools Only

Run the email-specific tests:

```bash
node test-mcp-emails.js
```

---

## Architecture

### Response Builder (`imports/api/tools/responseBuilder.js`)

Generates structured responses with:
- **Data:** The actual response data
- **Summary:** Auto-generated human-readable summary
- **Metadata:** Source, policy, timestamps

### Middleware (`imports/api/tools/middleware.js`)

Provides:
- **Loop detection:** Prevents infinite tool call loops
- **Logging:** Records all calls to MongoDB
- **Metrics:** Duration, success rate, result size

### Tool Handlers (`imports/api/tools/handlers.js`)

All 26 tools enhanced with:
- Structured responses via `buildSuccessResponse()`
- Structured errors via `buildErrorResponse()`
- Intelligent summaries per tool type

### MCP Server (`imports/api/mcp/server/mcp.js`)

JSON-RPC 2.0 handler with:
- Middleware integration
- Loop detection enforcement
- Automatic logging

---

## Best Practices (Clever Cloud Article)

These improvements follow the **"Building Smarter MCP Servers"** best practices:

1. ✅ **Narrow, well-named capabilities** - Each tool has a clear purpose
2. ✅ **Stable types** - JSON schemas with strict validation
3. ✅ **Deterministic behavior** - Same input → same output
4. ✅ **Least privilege** - Read-only by default, explicit write policy
5. ✅ **Input validation** - Strict parameter checking with helpful errors
6. ✅ **Human-readable outputs** - Every response includes a summary
7. ✅ **Explicability** - Source, policy, and provenance in metadata
8. ✅ **Rate limiting** - Protection against infinite loops
9. ✅ **Observability** - All calls logged with full context
10. ✅ **Structured errors** - Error codes, messages, and suggestions

---

## Migration Notes

### For Existing Integrations

The response format has changed. Old code expecting:
```javascript
const data = JSON.parse(result.content[0].text);
// { tasks: [...], total: 5 }
```

Should now expect:
```javascript
const response = JSON.parse(result.content[0].text);
const data = response.data;      // { tasks: [...], total: 5 }
const summary = response.summary; // "Found 5 tasks (2 urgent)"
```

### Backward Compatibility

The `data` field contains the same structure as before, so most code will work if you extract it:
```javascript
const { data } = JSON.parse(result.content[0].text);
// Use data as before
```

