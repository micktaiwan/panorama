# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Panorama is a **multi-user** project management and notes application built with **Meteor 3** and **React 18**. It features semantic search via Qdrant, AI integration (local Ollama or remote OpenAI), budget imports, in-app alarms, and Electron desktop support.

**Stack**: Meteor standard structure (imports/api for server, imports/ui for client, server/main.js, client/main.jsx, electron/ for desktop, docs/ for documentation). Commands: see package.json.

## Deployment Architecture

Two instances (local Electron + remote VPS at `panorama.mickaelfm.me`) share the **same remote MongoDB** on the VPS. All ~35 collections live in the remote DB. Qdrant also runs on the VPS. See `start-local.sh` for local setup, `.deploy/mup.js` for remote config.

### Known Limitations

- **No EMAIL_URL**: verification and reset password emails print to server console only
- **Client errors are never persisted**: the `errors` collection is fed only by the server `console.error` override (`imports/api/errors/serverConsoleOverride.js`). The `errors.insert` method has no caller anywhere, so a toast shown in the UI leaves no trace in the DB.

### Local Crash Diagnosis ("Panorama went down")

- **Where to read**: `~/Library/Logs/Panorama/lifecycle.log`, written by `start-local.sh` and kept across launches. It records `START`, `WATCHDOG` restarts (server died, usually on wake from sleep), `LOOP EXIT` (which process died, with exit code/signal), plus `MEM` lines every 15 min of awake time and `REBUILD` lines on wake-recovery restarts (RSS of the meteor tool and of the whole tree). The macOS crash reports are in `~/Library/Logs/DiagnosticReports/node-*.ips`; filter on `coalitionName: com.mickaelfm.panorama` (as of 2026-09-29, the other `node-*` reports were node processes started from a Kova terminal, not Panorama). The server's own stdout is only in the terminal that ran the script.
- **Open investigation (since 2026-09-29)**: the meteor tool (the node process that is the direct child of npm, not the app server) died of a V8 OOM (`FatalProcessOutOfMemory`, exit 134) on 2026-07-18, 2026-09-29 07:22 and 2026-09-30 10:42. **Leak hypothesis ruled out** (2026-09-30): over a 21 h session the tool's baseline RSS stayed flat at ~125-130 MB between rebuilds. **What the log shows instead**: each wake-recovery rebuild alone spikes the tool (1.2, 5.0, 6.6, 5.0, 2.0, 3.3 GB RSS sampled within 5 s of the trigger on the morning of 2026-09-30), and a spike can cross the 8 GB heap cap (`TOOL_NODE_FLAGS`): the 10:42 OOM hit 30 s after a `REBUILD` sampled at 3.3 GB. Every sleep, even a one-minute DarkWake, triggers one (6 rebuilds that morning, 3 of them within 7 min). **Likely cause (2026-09-30)**: the rspack server bundle `_build/main-dev/server-rspack.js` was 40 MB with a 46 MB source map, 32 of its 36 MB of sources being `googleapis` (every Google API). On each server rebuild the meteor tool re-reads that bundle and parses its map (`babel-compiler` skips transpiling rspack output but still `JSON.parse`s the `.map`); the OOM stack goes through a WASM call, consistent with source-map processing. **Fix applied**: `rspack.config.js` externalizes `googleapis` (`Meteor.compileWithMeteor`); a one-off build gave a 7.4 MB bundle and a 6.9 MB map. **First results** (session started 2026-10-02 15:38 with the fix, 7.4 MB bundle): the two wake-recovery `REBUILD`s sampled 755 MB and 1040 MB tool RSS (vs 2-6.6 GB before), no OOM after 27 h. **Check of 2026-10-08**: no Panorama OOM in 6 days with the fix (the `node-*` OOM reports of 10-06 and 10-08 are Kova), 18 rebuilds in the session started 2026-10-05 22:21. Tool peaks mostly 0.8-2.4 GB, highest 2.77 GB (2026-10-08 20:37), vs 2-6.6 GB before. To watch: on the night of 10-05, six rebuilds in 2 h climbed 0.77 -> 1.6 GB and the tool stayed at ~1.35 GB for 6 h before falling back to 271 MB at 08:44; rapid rebuilds still stack up. Raising the heap cap would only move the threshold.
- **Separate, known issue**: the app server dies on wake (the Mongo connection breaks while the Mac sleeps). `server/wakeRecovery.js` and the watchdog in `start-local.sh` restart it by rewriting `server/devRestartTrigger.js`, which is why that file shows up as modified in git.

### File Storage

Files are stored on the VPS filesystem (`/var/www/panorama/files/`). Two modes:
- **VPS (remote)**: files written directly to disk. Internal HTTP API (`/api/files/*`) serves requests from the local instance, protected by `X-API-Key` header.
- **Local (Electron)**: `PANORAMA_FILES_URL` + `PANORAMA_FILES_API_KEY` env vars set → file operations delegated to VPS via HTTP (`remoteFileClient.js`).
- **Dev/Test**: no env vars → local filesystem (`~/PanoramaFiles`).

Key files: `imports/api/files/methods.js` (branching logic), `imports/api/files/remoteFileClient.js` (HTTP client), `imports/api/files/internalRoutes.js` (VPS routes).

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
- **Quality loop**: `tool_searchHealth`, `tool_searchQualityTest` (async, returns a `runId` to poll), `tool_searchQualityRun`/`tool_searchQualityRuns`, `tool_searchDiagnoseIndexing`, `tool_searchAutoFix`, `tool_searchReindex`/`tool_searchIndexStatus`. Runs are persisted in `searchQualityRuns` (UI runs included). See `docs/features/13-feat-search.md`

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
- **Files and Links**: Files stored on VPS via internal HTTP API (see File Storage above), served via `/files/<storedFileName>` (authenticated)
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
