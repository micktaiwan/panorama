# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Panorama is a **local-first, single-user** project management and notes application built with **Meteor 3** and **React 18**. It features semantic search via Qdrant, AI integration (local Ollama or remote OpenAI), budget imports, in-app alarms, and Electron desktop support.

**Stack**: Meteor standard structure (imports/api for server, imports/ui for client, server/main.js, client/main.jsx, electron/ for desktop, docs/ for documentation). Commands: see package.json.

## Architecture Overview

### Data Layer (Meteor Collections)

- Server methods are **async** and use `insertAsync`, `updateAsync`, `removeAsync`, `findOneAsync`, `countAsync`
- Publications expose data to client (no user filtering, single-user app)
- Client uses `useTracker`, `useFind`, and custom hooks like `useSingle()` for reactive queries
- Collections: see imports/api/* (projects, tasks, notes, noteSessions, noteLines, situations, people, teams, budget, calendar, alarms, files, links, chats, userLogs, emails, appPreferences, errors)

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

### UI Component Patterns

#### Component Structure
- **One component = one directory**: `ComponentName/ComponentName.jsx` + `ComponentName.css`
- **No inline styles**: All styling via CSS classes
- **Reusable components** in `imports/ui/components/` (TaskRow, Card, Modal, Notify)
- **Page components** in `imports/ui/` subdirectories (Dashboard, ProjectDetails, Preferences)

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

### Configuration System

Configuration is resolved in this order (highest priority first):
1. App Preferences (stored in MongoDB via Preferences UI)
2. Environment variables (`PANORAMA_FILES_DIR`, `QDRANT_URL`, `OPENAI_API_KEY`, `PENNYLANE_TOKEN`)
3. Meteor settings (`settings.json` or `METEOR_SETTINGS`)
4. Safe defaults

`settings.json` is **gitignored**. Use App Preferences or env vars for secrets.

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
- **Local-first app**: minimal security concerns (single-user, trusted environment)
- **LLM responses**: no validation/sanitization (trust AI providers)
- **API keys**: store in App Preferences or env vars, no format validation

## Key Features

- **In-App Alarms**: Client-side scheduler (setTimeout + 60s tick), multi-tab coordination (BroadcastChannel), catch-up on startup, snooze support. See `docs/features/12-feature-alarms.md`
- **Files and Links**: Files uploaded to external directory (filesDir in preferences), served via `/files/<storedFileName>`. Links stored with metadata.
- **Budget Imports**: Import from Pennylane CSV or API. Parse with `xlsx` library. See `imports/ui/Budget/import/parseWorkbook.js`
- **Export/Import**: Export to JSON (small DBs) or NDJSON archive (large DBs). Calendar events excluded. Qdrant vectors: recompute on import.
- **Situations Analyzer**: LLM-powered workspace for analyzing scenarios. Prompt helpers in `imports/api/situations/promptHelpers.js`
- **Gmail Integration**: OAuth2 integration for reading emails. Collections: `emails`. See `docs/gmail-setup.md`

## Testing

- Mocha test runner via `meteortesting:mocha`
- Test files: `**/__tests__/**/*.js` or `**/*.test.js`
- Run with: `meteor test --once --driver-package meteortesting:mocha`

## Documentation

Key docs in `docs/`: `02-tech-notes.md` (technical guidelines), `03-schemas.md` (collection schemas), `04-electron.md` (packaging), `ai-proxy.md` (AI architecture), `gmail-setup.md` (Gmail OAuth2), `features/` (feature-specific docs)

## Common Patterns and Gotchas

### When Adding a New Collection
1. Create `imports/api/resourceName/collections.js` (schema and collection)
2. Create `imports/api/resourceName/methods.js` (CRUD methods, all async)
3. Create `imports/api/resourceName/publications.js` (expose data to client)
4. Import all three in `server/main.js`
5. If searchable: register in `vectorStore.js` and call `upsertDoc`/`deleteDoc` in methods

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
