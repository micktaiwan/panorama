# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**NEVER modify code, files, or documents without explicit user confirmation. Always ask before making any change.**

## Project Overview

Panorama is a **multi-user** project management and notes application built with **Meteor 3** and **React 18**. It features semantic search via Qdrant, AI integration (local Ollama or remote OpenAI), budget imports, in-app alarms, and Electron desktop support. Authentication and multi-tenancy with `userId` on **all collections** are implemented.

**Repo owner**: Mickael FM aka Mick (`micktaiwan` on GitHub), frère de David FM aka Dayd (`ddaydd` on GitHub) qui contribue aussi au projet.

**Stack**: Meteor standard structure (imports/api for server, imports/ui for client, server/main.js, client/main.jsx, electron/ for desktop, docs/ for documentation). Commands: see package.json.

### Database Access

In local dev mode (Mick's Mac), `MONGO_URL` points to the VPS via TLS + auth (`panorama.mickaelfm.me:27018`). Credentials in `~/.env.secrets` (`PANORAMA_MONGO_USER`, `PANORAMA_MONGO_PASS`). When `MONGO_URL` is set, Meteor does **not** start its internal MongoDB — all collections use the remote database.

```bash
# Connect to the database (all collections)
mongosh "mongodb://$PANORAMA_MONGO_USER:$PANORAMA_MONGO_PASS@panorama.mickaelfm.me:27018/panorama?tls=true&authSource=admin"
```

In dev/test mode (no `MONGO_URL` set), Meteor starts its own MongoDB on port `METEOR_PORT + 1`. All collections are local.

**Do NOT use** `mongosh meteor` or the system MongoDB — those are different databases and will return empty results.

**Important**: When inserting documents directly via `mongosh`, use **string IDs** (not `ObjectId`) for Meteor compatibility. Meteor collections expect string `_id` values.

## Architecture Overview

### Data Layer (Meteor Collections)

- Server methods are **async** and use `insertAsync`, `updateAsync`, `removeAsync`, `findOneAsync`, `countAsync`
- **All collections** have `userId` field, publications filter by `this.userId`, methods use `ensureLoggedIn` + `ensureOwner`. Exception: `appPreferences` is a global singleton (no userId)
- **Auth helpers** in `imports/api/_shared/auth.js`: `ensureLoggedIn(userId)`, `ensureOwner(collection, docId, userId)`
- Client uses `useTracker`, `useFind`, and custom hooks like `useSingle()` for reactive queries
- Collections: see imports/api/* (projects, tasks, notes, noteSessions, noteLines, situations, people, teams, budget, calendar, alarms, files, links, chats, userLogs, emails, appPreferences, userPreferences, errors)

### AI Integration Architecture

The app uses a **proxy pattern** to route AI calls between local and remote providers:

- **LLM Proxy** (`imports/api/_shared/llmProxy.js`)
  - Central routing: `chatComplete()` and `embed()` functions
  - Automatic provider selection based on mode (`local`, `remote`, `auto`)
  - Health checks cached for 5 minutes, fallback logic when unavailable

- **Providers** (`imports/api/_shared/aiCore.js`)
  - **Ollama** (local): `llama3.1:8b-instruct` for chat, `nomic-embed-text` for embeddings
  - **OpenAI** (remote): `gpt-4o-mini` for chat, `text-embedding-3-small` for embeddings
  - Normalized response format across both providers

- **Configuration** (`imports/api/_shared/config.js`)
  - Config resolved from: App Preferences → Env vars → Meteor settings → Safe defaults
  - `getAIConfig()`, `getOpenAiApiKey()`, `getQdrantUrl()` helper functions

- **Usage**: Import from llmProxy.js: `chatComplete({system, messages, temperature, maxTokens})`, `embed([texts])`

### Semantic Search (Qdrant)

- Local vector database for semantic search across projects/tasks/notes
- Collection naming: remote mode uses `panorama`, local mode uses `panorama_<model_name>`
- Vector dimensions are model-dependent (1536 for OpenAI, 768 for nomic-embed-text)
- **Manual reindexing required** when switching embedding models or AI modes
- Abstractions in `imports/api/search/vectorStore.js`: `embedText(text)`, `upsertDoc({kind, id, text, projectId})`, `deleteDoc(kind, id)`
- Fallback to `search.instant` when Qdrant unavailable
- **Known gap**: Qdrant index is currently global (no `userId` in payloads or search filters). `collectDocs()`/`collectDocsByKind()` in `search/methods.js` query remote collections without userId filtering. Phase 7 will add per-user isolation. See `docs/multi-user-migration-plan.md`

### UI Component Patterns

#### Component Structure
- **One component = one directory**: `ComponentName/ComponentName.jsx` + `ComponentName.css`
- **No inline styles**: All styling via CSS classes
- **Reusable components** in `imports/ui/components/` (TaskRow, Card, Modal, Notify)
- **Page components** in `imports/ui/` subdirectories (Dashboard, ProjectDetails, Preferences)

#### Theming
- **Always use CSS variables** (`var(--panel)`, `var(--text)`, `var(--border)`, etc.) for colors — never hardcode hex/rgb values
- The app supports light and dark themes; hardcoded colors break one or the other

#### Key Patterns
- **Inline editing**: Click to edit, Enter to save, Esc to cancel (via `InlineEditable` component)
- **Card pattern**: Consistent container with `Card({title, actions, children})`
- **Modal/Confirm**: Never use `window.alert`/`window.confirm` — use `Modal` component
- **Toast notifications**: Use `Notify` component (info/success/error)
- **Collapsible sections**: Use `Collapsible` component for expandable UI
- **Scroll areas**: Always use `.scrollArea` utility class (prevents scroll chaining)

#### React Hooks
- **Always call hooks at top-level** (never conditionally)
- Use `useSingle(getCursor)` for queries returning one document
- Use neutral selectors (`{_id: '__none__'}`) when params are absent to maintain stable hook order
- Example: Query session, then project using `session?.projectId ? {_id: session.projectId} : {_id: '__none__'}`
- **`useSubscribe` returns isLoading, not isReady**: `const sub = useSubscribe('pubName')` → `sub()` returns `true` while loading. Use `!sub()` for ready check.

### Configuration System

Two preference collections:
- **`userPreferences`** (per-user, remote): `theme`, `openaiApiKey`, `anthropicApiKey`, `perplexityApiKey`, `ai` (mode, fallback, models, timeouts)
- **`appPreferences`** (instance, local): `filesDir`, `qdrantUrl`, `devUrlMode`, `localUserId`, `pennylaneBaseUrl`, `pennylaneToken`, `slack`, `googleCalendar`, `cta`

Configuration is resolved in this order (highest priority first):
1. User Preferences (per-user, stored in `userPreferences` collection)
2. App Preferences (instance-level, stored in `appPreferences` collection)
3. Environment variables (`PANORAMA_FILES_DIR`, `QDRANT_URL`, `OPENAI_API_KEY`, `PENNYLANE_TOKEN`)
4. Meteor settings (`settings.json` or `METEOR_SETTINGS`)
5. Safe defaults

Config helpers in `imports/api/_shared/config.js`:
- **Sync getters** (instance-level, for server code outside methods): `getAIConfig()`, `getOpenAiApiKey()`, `getQdrantUrl()`, `getLocalUserId()`
- **Async getters** (user-aware, for methods with `this.userId`): `getAIConfigAsync(userId)`, `getOpenAiApiKeyAsync(userId)`, `getAnthropicApiKeyAsync(userId)`

`settings.json` is **gitignored**. Use User/App Preferences or env vars for secrets.

### Routing and Navigation

- Hash-based routing (e.g., `#/project/abc123`, `#/help`)
- Access pages via routes only; components read params from router
- Deep-link highlighting: `useHashHighlight(paramKey, clearToHash)` and `useRowHighlight(id, selector, onClear)`

## Code Style and Conventions

### Error Handling Policy
- **Default: no try/catch** (prefer fail-fast)
- **Never silent catches**: Never `catch (_e) {}`
- If try/catch needed: log errors or re-throw explicit `Meteor.Error`
- **Always use optional chaining**: `obj?.property` instead of `obj && obj.property`
- Example: `data?.user?.name ?? 'default'`

### String Normalization
- Trim short text fields (name, title) on **server save**, not at display time
- Do NOT trim rich text/markdown `content` fields
- Helpers: `imports/ui/utils/strings.js` (client), `imports/api/_shared/strings.js` (server)

### Notifications
- No `window.alert` or `window.confirm`
- Use `Modal` for confirmations, `Notify` for toasts
- Copy guidelines: concise, action-led

### Security Policy
- **Multi-user app**: authentication required, userId isolation on **all** collections
- **All collections** (except appPreferences): `ensureLoggedIn` + `ensureOwner` on methods, publications filter by `userId`
- **MCP tools**: use `localUserId` from `appPreferences` for server-to-server calls (no DDP session)
- **LLM responses**: no validation/sanitization (trust AI providers)
- **API keys**: store in User Preferences or env vars, no format validation
- **Qdrant**: currently global (no per-user isolation) — Phase 7 pending

## Key Features

- **In-App Alarms**: Client-side scheduler (setTimeout + 60s tick), multi-tab coordination (BroadcastChannel), catch-up on startup, snooze support. See `docs/features/12-feature-alarms.md`
- **Files and Links**: Files uploaded to external directory (filesDir in preferences), served via `/files/<storedFileName>`. Links stored with metadata.
- **Budget Imports**: Import from Pennylane CSV or API. Parse with `xlsx` library. See `imports/ui/Budget/import/parseWorkbook.js`
- **Export/Import**: Export to JSON (small DBs) or NDJSON archive (large DBs). Calendar events excluded. Qdrant vectors: recompute on import.
- **Situations Analyzer**: LLM-powered workspace for analyzing scenarios. Prompt helpers in `imports/api/situations/promptHelpers.js`
- **Gmail Integration**: OAuth2 integration for reading emails. Collections: `emails`. See `docs/gmail-setup.md`
- **Claude Code**: In-app Claude CLI integration with session management, permission prompts, and shell escape (`!command`). UI: `imports/ui/ClaudeCode/`, API: `imports/api/claudeSessions/`, `imports/api/claudeMessages/`. Logs: `~/.panorama-claude.log`. See `docs/features/23-feature-claude-code.md`

## Testing

- Mocha test runner via `meteortesting:mocha`
- Test files: `**/__tests__/**/*.js` or `**/*.test.js`
- Run with: `meteor test --once --driver-package meteortesting:mocha`

## Documentation

Key docs in `docs/`: `02-tech-notes.md` (technical guidelines), `03-schemas.md` (collection schemas), `04-electron.md` (packaging), `ai-proxy.md` (AI architecture), `gmail-setup.md` (Gmail OAuth2), `multi-user-migration-plan.md` (multi-user migration phases 1-7), `features/` (feature-specific docs)

## Common Patterns and Gotchas

### When Adding a New Collection
1. Create `imports/api/resourceName/collections.js` (schema and collection)
2. Create `imports/api/resourceName/methods.js` (CRUD methods, all async)
3. Create `imports/api/resourceName/publications.js` (expose data to client)
4. Import all three in `server/main.js`
5. If searchable: register in `vectorStore.js` and call `upsertDoc`/`deleteDoc` in methods
6. Add `userId` to inserts, `ensureLoggedIn` + `ensureOwner` to update/remove, filter publications by `userId`, add MongoDB index `{ userId: 1 }` in `server/main.js` startup

### When Adding AI Features
- Use `chatComplete()` or `embed()` from `llmProxy.js`
- Do NOT call OpenAI directly
- Handle both streaming and non-streaming responses
- Add appropriate error handling (log, don't silence)

### When Creating Components
- Create `ComponentName/ComponentName.jsx` and `ComponentName.css`
- No inline styles
- Use shared utilities (`.scrollArea`, `Card`, `Modal`, `Notify`)
- Follow spacing tokens: 8, 12, 16, 24px

### When Working with Hooks
- Declare all hooks at top-level (stable order)
- Never conditionally call hooks
- Use `useSingle()` for single-document queries
- Use neutral selectors when params may be absent

### Before Switching Embedding Models
1. Update AI preferences in UI (Preferences → AI)
2. **Rebuild Qdrant index** (Preferences → Qdrant → Rebuild)
3. Verify search works with new model

### MCP-First Policy (When Working with Panorama Data)

**CRITICAL**: When Claude Code needs to access or manipulate Panorama data, **ALWAYS use MCP tools first**. Never bypass to direct database access (bash, mongosh, meteor shell) without exhausting all MCP options.

#### The Rule

1. **Try MCP tools with different parameters** before considering direct access
2. **Check response metadata hints** for parameter suggestions
3. **Consult COMMON_QUERIES** in `imports/api/tools/helpers.js` for pre-tested patterns
4. **Create a new MCP tool** if none fit your need (see `docs/panorama_mcp_tool_creation.md`)
5. **Only use direct access** as an absolute last resort for debugging or emergency fixes

#### Why This Matters

- **Observability**: All MCP calls logged to `toolCallLogs` with timing and status
- **Safety**: Built-in validation, error handling, rate limiting
- **Consistency**: Structured `{data, summary, metadata}` responses
- **Future-proof**: Tools evolve with the codebase; one-off queries don't

#### Tool Call Optimization

**Minimize MCP tool calls** - each call has overhead. Follow these principles:

1. **Use partial updates**: Update tools (`tool_updateTask`, `tool_updateNote`, `tool_updateProject`) support partial updates. Only pass the fields you want to change.
   ```javascript
   // ✅ GOOD: Update just the title
   tool_updateNote({noteId: "abc", title: "New Title"})

   // ❌ BAD: Reading the full note first is unnecessary
   tool_noteById({noteId: "abc"})  // ← Unnecessary read!
   tool_updateNote({noteId: "abc", title: "New Title", content: existingContent})
   ```

2. **Batch related operations**: When possible, use tools that return multiple items instead of making N individual calls.
   ```javascript
   // ✅ GOOD: One call for all tasks
   tool_tasksByProject({projectId: "abc"})

   // ❌ BAD: N calls for N tasks
   for (taskId in taskIds) tool_taskById({taskId})
   ```

3. **Choose the right tool**: Use specialized tools instead of generic queries when available.
   ```javascript
   // ✅ GOOD: Specialized tool
   tool_tasksFilter({dueBefore: "2025-01-30", urgent: true})

   // ⚠️ ACCEPTABLE: Generic query (only if specialized tool doesn't exist)
   tool_collectionQuery({collection: "tasks", where: {...}})
   ```

4. **Read once, use everywhere**: If you need to read data, cache it in memory and reference it multiple times instead of re-reading.

#### Example: The Wrong Way

```bash
# ❌ DON'T: Bypassing MCP when a query seems insufficient
User: "List tasks with deadlines"
Claude: [Calls tool_collectionQuery, gets unexpected results]
Claude: "Let me use mongosh to query the database..."
mongosh panorama --eval "db.tasks.find({deadline: {$ne: null}})"
```

#### Example: The Right Way

```javascript
// ✅ DO: Exhaust MCP options with different approaches
User: "List tasks with deadlines"
Claude: [Calls tool_collectionQuery with basic where clause]
Claude: "Not quite right. Let me try tool_tasksFilter with refined parameters..."
Claude: [Calls tool_tasksFilter with proper filters]
// OR
Claude: "Let me check COMMON_QUERIES for a pre-tested pattern..."
Claude: [Uses COMMON_QUERIES.tasksWithDeadline via tool_collectionQuery]
```

#### Available MCP Tools

Key tools for data access (see `imports/api/tools/definitions.js` for complete list):

- **Tasks**: `tool_tasksByProject`, `tool_tasksFilter`, `tool_createTask`, `tool_updateTask`, `tool_deleteTask`
- **Projects**: `tool_projectsList`, `tool_projectByName`, `tool_createProject`, `tool_updateProject`, `tool_projectsOverview`
- **Notes**: `tool_notesByProject`, `tool_noteById`, `tool_createNote`, `tool_updateNote`, `tool_deleteNote`
- **Search**: `tool_semanticSearch` (Qdrant), `tool_collectionQuery` (generic MongoDB DSL)
- **Emails**: `tool_emailsSearch`, `tool_emailsRead`, `tool_emailsUpdateCache`

#### Escalation Workflow

When an MCP tool doesn't work:

1. **Refine parameters**: Check metadata hints, try different filter combinations
2. **Try related tools**: Use specialized tools (`tool_tasksFilter` vs `tool_collectionQuery`)
3. **Check helpers**: Review `COMMON_QUERIES` in `helpers.js` for patterns
4. **Create new tool**: Follow `docs/panorama_mcp_tool_creation.md` to extend the API
5. **Direct access**: Only if debugging production issues or the tool can't be created immediately

#### When Direct Access Is Acceptable

- **Debugging production issues**: Quick diagnostic queries to understand a problem
- **Schema migrations**: One-time bulk updates during development
- **MCP server is down**: Emergency access when the MCP endpoint is unavailable
- **Performance analysis**: Direct MongoDB queries to diagnose slow operations

In all other cases: **Create a proper MCP tool instead of using one-off queries.**
