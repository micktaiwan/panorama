# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Panorama is a **multi-user** project management and notes application built with **Meteor 3** and **React 18**. It features semantic search via Qdrant, AI integration (local Ollama or remote OpenAI), budget imports, in-app alarms, and Electron desktop support.

**Stack**: Meteor standard structure (imports/api for server, imports/ui for client, server/main.js, client/main.jsx, electron/ for desktop, docs/ for documentation). Commands: see package.json.

## Deployment Architecture

Two instances (local Electron + remote VPS at `panorama.mickaelfm.me`) share the **same remote MongoDB** on the VPS. All ~35 collections live in the remote DB. Qdrant also runs on the VPS. See `start-local.sh` for local setup, `.deploy/mup.js` for remote config.

### Known Limitations

- **HTTP routes not secured**: `/files/<name>`, `/tasks-mobile`, `/download-export/<jobId>` have no auth check — to fix before opening signup
- **No EMAIL_URL**: verification and reset password emails print to server console only
- **No backup for DB `panorama`**: only `organizer` DB has automated backup

### Direct Database Access (fallback)

If MCP tools are insufficient, you can access the DB directly via mongosh. Credentials in `~/.env.secrets`. Use **string IDs** (not `ObjectId`) for Meteor compatibility.
```bash
mongosh "mongodb://$PANORAMA_MONGO_USER:$PANORAMA_MONGO_PASS@panorama.mickaelfm.me:27018/panorama?tls=true&authSource=admin"
```

## Architecture Overview

### Data Layer (Meteor Collections)

- Server methods are **async** and use `insertAsync`, `updateAsync`, `removeAsync`, `findOneAsync`, `countAsync`
- **All collections** have `userId` field. Auth helpers in `imports/api/_shared/auth.js`: `ensureLoggedIn(userId)`, `ensureOwner(collection, docId, userId)`. Publications filter by `this.userId`. Exception: `appPreferences` is a global singleton (no userId)
- Client uses `useTracker`, `useFind`, and custom hooks like `useSingle()` for reactive queries
- Collections: see imports/api/* (projects, tasks, notes, noteSessions, noteLines, situations, people, teams, budget, calendar, alarms, files, links, chats, userLogs, emails, appPreferences, userPreferences, errors)

### AI Integration

Uses a **proxy pattern** — import from `imports/api/_shared/llmProxy.js`: `chatComplete({system, messages, temperature, maxTokens})`, `embed([texts])`. Do NOT call OpenAI directly. See `docs/ai-proxy.md` for details on providers, config resolution, and health checks.

### Semantic Search (Qdrant)

- Abstractions in `imports/api/search/vectorStore.js`: `embedText(text)`, `upsertDoc({kind, id, text, projectId})`, `deleteDoc(kind, id)`
- Qdrant payloads include `userId`, all searches filter by userId
- **Manual reindexing required** when switching embedding models (Preferences > Qdrant > Rebuild)
- Fallback to `search.instant` when Qdrant unavailable
- **URLs**: Local (Mick): `http://localhost:16333` via autossh tunnel (port 16333 → VPS 6333), configuré dans `start-local.sh`. Production (VPS): `http://organizer-qdrant:6333` (Docker internal, env `QDRANT_URL` in `.deploy/mup.js`). Version VPS: v1.16.3. Qdrant REST API accessible via curl sur ces URLs.
- **Collection naming**: `panorama` (remote mode) or `panorama_<model_name>` (local mode)
- **Client lib**: `@qdrant/js-client-rest` v1.15+

### UI Component Patterns

- **One component = one directory**: `ComponentName/ComponentName.jsx` + `ComponentName.css`
- **No inline styles**: All styling via CSS classes
- **Always use CSS variables** (`var(--panel)`, `var(--text)`, `var(--border)`, etc.) — never hardcode hex/rgb (light/dark theme support)
- **Never use `window.alert`/`window.confirm`** — use `Modal` component for confirmations, `Notify` for toasts
- Other reusable components: `Card`, `InlineEditable`, `Collapsible`, `.scrollArea` utility class
- Follow spacing tokens: 8, 12, 16, 24px

### React Hooks

- **Always call hooks at top-level** (never conditionally)
- Use `useSingle(getCursor)` for queries returning one document
- Use neutral selectors (`{_id: '__none__'}`) when params are absent to maintain stable hook order
- **`useSubscribe` returns isLoading, not isReady**: `sub()` returns `true` while loading. Use `!sub()` for ready check.

### Configuration System

Two preference collections:
- **`userPreferences`** (per-user): `theme`, `openaiApiKey`, `anthropicApiKey`, `perplexityApiKey`, `ai` (mode, fallback, models, timeouts)
- **`appPreferences`** (instance-level): `filesDir`, `qdrantUrl`, `devUrlMode`, `localUserId`, `pennylaneBaseUrl`, `pennylaneToken`, `slack`, `googleCalendar`, `cta`

Resolution order: User Preferences > App Preferences > Env vars > Meteor settings > Safe defaults. Config helpers in `imports/api/_shared/config.js` (sync getters for server code, async getters for methods with `this.userId`).

### Routing and Navigation

- Hash-based routing (e.g., `#/project/abc123`, `#/help`)
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

### Security Policy
- **All collections** (except appPreferences): `ensureLoggedIn` + `ensureOwner` on methods, publications filter by `userId`
- **MCP tools**: use `localUserId` from `appPreferences` for server-to-server calls (no DDP session)
- **API keys**: store in User Preferences or env vars, no format validation

## Key Features

- **In-App Alarms**: Client-side scheduler, multi-tab coordination (BroadcastChannel), catch-up on startup, snooze. See `docs/features/12-feature-alarms.md`
- **Files and Links**: Files uploaded to external directory (filesDir), served via `/files/<storedFileName>`
- **Budget Imports**: Import from Pennylane CSV or API. See `imports/ui/Budget/import/parseWorkbook.js`
- **Export/Import**: JSON or NDJSON archive. Calendar events excluded. Qdrant vectors: recompute on import.
- **Gmail Integration**: OAuth2 for reading emails. See `docs/gmail-setup.md`
- **Claude Code**: In-app Claude CLI integration. UI: `imports/ui/ClaudeCode/`, API: `imports/api/claudeSessions/`. See `docs/features/23-feature-claude-code.md`

## Deployment

Deploy via `./deploy.sh` (Meteor Up). First-time setup: `source ~/.env.secrets && cd .deploy && nvm exec 20.9.0 mup setup`

## Testing

Run with: `meteor test --once --driver-package meteortesting:mocha`. Test files: `**/__tests__/**/*.js` or `**/*.test.js`

## Common Patterns and Gotchas

### When Adding a New Collection
1. Create `imports/api/resourceName/collections.js`, `methods.js`, `publications.js`
2. Import all three in `server/main.js`
3. Add `userId` to inserts, `ensureLoggedIn` + `ensureOwner` to update/remove, filter publications by `userId`, add MongoDB index `{ userId: 1 }` in `server/main.js` startup
4. If searchable: register in `vectorStore.js` and call `upsertDoc`/`deleteDoc` in methods

### When Adding AI Features
- Use `chatComplete()` or `embed()` from `llmProxy.js` — do NOT call OpenAI directly
- Handle both streaming and non-streaming responses

### MCP-First Policy (When Working with Panorama Data)

**Always use MCP tools first** to access Panorama data. Never bypass to mongosh without exhausting MCP options. MCP tools support partial updates, batch operations, and specialized filters. Use `tool_collectionQuery` with `COMMON_QUERIES` from `imports/api/tools/helpers.js` for advanced patterns. If no tool fits, create one (see `docs/panorama_mcp_tool_creation.md`).
