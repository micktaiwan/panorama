# Feature: global AI chat

## Goal

Provide a global AI chat interface that can be used to ask questions about the workspace. The chat uses the vector database to be context-aware and relevant.

## Architecture

### AI Proxy System

The AI Proxy provides a unified interface for all AI operations (chat completions and embeddings) with automatic routing between local (Ollama) and remote (OpenAI) providers based on user preferences and health checks.

#### Core Components

1. **LLM Proxy** (`imports/api/_shared/llmProxy.js`)
   - Central routing logic for all AI calls
   - Health check management with 5-minute caching
   - Automatic fallback handling
   - Provider selection based on mode and health

2. **Providers** (`imports/api/_shared/aiCore.js`)
   - `ollama`: Local Ollama integration with Metal acceleration
   - `openai`: Remote OpenAI API integration
   - Normalized response format across providers

3. **Configuration** (`imports/api/_shared/config.js`)
   - Dynamic AI preferences management
   - Default values and validation
   - Integration with AppPreferences collection

4. **UI Integration** (`imports/ui/Preferences/Preferences.jsx`)
   - Comprehensive settings interface
   - Real-time health monitoring
   - Provider testing capabilities

#### Provider Selection Logic

- **Local mode**: Always use Ollama (offline-first)
- **Remote mode**: Always use OpenAI (requires API key)
- **Auto mode**: Use local if healthy, fallback to remote if configured

### Vector Store Integration

The system automatically handles different embedding dimensions and collection naming:

- **Dynamic vector size detection** based on current model
- **Collection naming strategy**:
  - Remote mode: Uses base collection name (e.g., `panorama`)
  - Local mode: Uses model-specific collections (e.g., `panorama_nomic_embed_text_latest`)
- **Manual reindexing** required when switching models or AI modes
- **Fallback search** to `search.instant` when Qdrant is unavailable in local mode

## Scope (MVP)

- UI: popup button in the bottom-right corner of the screen (open on click).
- UI: chat interface with a text input. Enter to send; Shift+Enter for newline. No send button.
- UI: dark theme. Two layouts: floating bubble and docked right sidebar.
- UI: keyboard shortcuts — ⌘D: toggle open/close; ⌘⇧D: toggle docked vs bubble (opens when docking).
- AI: tool-calling + synthesis with OpenAI (`model: o4-mini`).
  - First pass: Responses API with tools (auto tool selection).
  - Tools executed on the server.
  - Final pass: Chat Completions for synthesis using only tool results.
- Use Qdrant for vector search.
- Follow the same client pattern for OpenAI usage as other features.
- The agent should be able to perform actions (create projects, tasks, notes, etc.)
  - Implement function calling with OpenAI.
  - The agent should always confirm actions with the user.

## Acceptance criteria

- Chat opens/closes via button and ⌘D.
- Docking sidebar toggles via ⌘⇧D; persists while open.
- Messages send with Enter; multiline with Shift+Enter.
- Responses render with optional citations (links).
- Errors are surfaced in the conversation.

## Configuration

### AI Preferences Schema

```javascript
{
  mode: 'local' | 'remote' | 'auto',        // Default: 'remote'
  fallback: 'none' | 'local' | 'remote',    // Default: 'local'
  timeoutMs: number,                        // Default: 30000
  maxTokens: number,                        // Default: 4000
  temperature: number,                      // Default: 0.7
  local: {
    host: string,                           // Default: 'http://127.0.0.1:11434'
    chatModel: string,                      // Default: 'llama3.1:8b-instruct'
    embeddingModel: string                  // Default: 'nomic-embed-text'
  },
  remote: {
    provider: 'openai',                     // Default: 'openai'
    chatModel: string,                      // Default: 'gpt-4o-mini'
    embeddingModel: string                  // Default: 'text-embedding-3-small'
  }
}
```

### OpenAI API Key

- Configure the key in Preferences → Secrets → "OpenAI API Key".
- The key is read by the server via `getOpenAiApiKey()` (order: AppPreferences → env vars → Meteor settings).
- The "Remote AI (OpenAI) → API Key" UI field is not used; keep Secrets as the single place to configure the key.

## Implementation notes

### Server

- Uses Responses API (no streaming) for the first pass; logs system/user prompts and response meta.
- Executes tool calls and logs selectors/results size.
- Uses Chat Completions for the final synthesis with `assistant.tool_calls` + `tool` messages; guidance forces using ONLY tool results and listing all items + total count.
- System prompt includes the current date/time and timezone (e.g., `Current date/time: 2025-09-08T22:30:00.000Z (Europe/Paris)`).

### Client

- History persistence: flat `ChatsCollection` storing individual messages for reload resilience.
- UI feedback: user message appears instantly; header shows "Sending…"; a temporary assistant "Thinking…" bubble is displayed while waiting.
- LocalStorage persistence for panel state (open/docked).

### Retrieval

- Uses Qdrant (embeddings: `text-embedding-3-small` for remote, `nomic-embed-text` for local).
- Top‑k results are returned as citations.

## Tools

The source code is the reference. See `imports/api/chat/tools_helpers.js` for the up-to-date definition of tools exposed to the model (Responses API) and `TOOL_HANDLERS` in `imports/api/chat/methods.js` for their server-side implementation.

Detailed descriptions (inputs/outputs/behaviors) are auto-documented in the code (schemas and selectors). Avoid duplication here.

## Usage

### Chat Completions

```javascript
import { chatComplete } from '/imports/api/_shared/llmProxy';

const result = await chatComplete({
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Hello!' }],
  temperature: 0.7,
  maxTokens: 1000
});

console.log(result.text); // Generated response
```

### Embeddings

```javascript
import { embed } from '/imports/api/_shared/llmProxy';

const result = await embed(['Text to embed', 'Another text']);
console.log(result.vectors); // Array of embedding vectors
```

### Health Checks

```javascript
import { getHealthStatus } from '/imports/api/_shared/llmProxy';

const health = await getHealthStatus();
console.log(health.local.ok);   // true/false
console.log(health.remote.ok);  // true/false
```

### Server Methods

- `ai.healthcheck()` — Returns health status for both providers.
- `ai.testProvider(provider, options)` — Tests a specific provider with sample data.
- `ai.saveRemoteKey(apiKey)` — Securely stores OpenAI API key server-side.
- `ai.updatePreferences(preferences)` — Updates AI configuration preferences.

## Planner roadmap

### Goals

- Strong requirement: genericity. The planner must work across any collection/tool and any prompt, not just tasks.
- Chain tool calls using previous outputs.
- Stop when enough information is available to answer; otherwise re‑plan once.
- Deterministic, observable, and safe (no actions without confirmation).

### Core design

- Plan schema
  - `steps[]`: `{ tool, args, saveAs?, expect?: { var: 'artifact.path' } }` (no domain coupling)
  - `stopWhen`: declarative artifacts, e.g. `{ have: ['list.*'] }` or `{ have: ['tasks[]'] }` per plan
- Working memory (per request)
  - Generic `kv`: `{ ids.*, params.*, lists.*, entity.*, errors[] }` (e.g., `ids.projectId`, `lists.tasks[]`)
  - Map tool outputs into memory via `saveAs`/`expect` (e.g., toolOutput.path → memory.key)
- Tool I/O contract
  - Each tool returns `{ data, error?, warning?, meta? }` with typed artifacts (lists, entity, ids).
  - Flag read-only vs mutation; mutations require `confirmed: true`.
- Execution loop
  - Bind args from memory (support `{var:'ids.projectId'}`, `{var:'params.tag'}`, etc.).
  - Validate args; if missing, re‑plan once with memory snapshot; else surface a concise error.
  - Execute tool with timeouts and bounded retries.
  - Validate output; map expected fields to memory; append status.
  - Check stop condition via declared artifacts, not hardcoded to specific domains.
- Re‑plan support
  - If binding fails or output is empty/error, re‑plan with: user question, memory snapshot, and failure reason.
  - Guardrails: at most 1 re‑plan; cap total steps (e.g., 5).
- Mutation gating
  - If a step is a mutation and `confirmed !== true`, halt and ask for confirmation (summarize changes), then resume.
- Errors
  - No silent catches; user sees short, clear messages; detailed logs server‑side.
- Observability
  - Log structured plan, steps (args redacted), durations, output sizes, stop reason.
  - Metrics: success rate, average steps, tool latencies.
- Safety/validation
  - Server-side schema validation for args/outputs; ISO dates, non‑empty ids, enums.
  - Idempotency keys for mutations.
- Performance
  - Parallelize retrieval inside a step when safe (e.g., multiple previews).
  - Cache short‑lived lookups (e.g., `projectByName`) per request.

### Implementation roadmap

- Phase 1 — Minimal chaining
  - [x] Add working memory and a single‑pass loop.
  - [x] Implement variable binding for `chat_projectByName → chat_tasksByProject`.
  - [x] Introduce declarative stopWhen (generic artifacts) instead of hardcoded checks.
  - [x] Expose semantic search as tool (`chat_semanticSearch`).
  - [x] Refactor tool execution to dispatch table (generic executor for planner steps).
- Phase 2 — Re‑plan
  - [x] Planner prompt includes available memory vars and failure reasons.
  - [x] Allow one re‑plan while keeping the overall step budget.
- Phase 3 — Synthesis hardening (lean)
  - [x] Enforce generic synthesis: no internal IDs, list all items with totals, clamp long fields.
- Phase 4 — Mutation flow
  - [ ] Add confirmation gate; introduce `confirmed` arg; summarize changes before execution.
- Phase 5 — Tool contracts
  - [ ] Standardize tool envelopes `{ data, warning?, error? }` and validators; consistent error messages.
- Phase 6 — Observability
  - [x] Log chat_semanticSearch meta (query, limit, total, top scores).
  - [ ] Structured logs and metrics; weekly report on top plans and failure causes.
- Phase 7 — Tests
  - [x] Unit: binding (projectId injection into `chat_tasksByProject`).
  - [x] Unit: cap 5 tool-calls (fallback path).
  - [ ] Unit: generic mapping, declarative stopWhen, re‑plan path.
  - [ ] Integration: two‑step chain `projectByName → tasksByProject`; mutation confirm resume.
  - [ ] Property tests: never exceed `MAX_STEPS`; outputs respect schema.

### Non-planner tracks

- Context-awareness and UX
  - [ ] Inject current UI context (current route/project) into the planner input to bias `chat_tasksByProject` when applicable.
  - [ ] Add per-item CTAs in answers that list tasks (open project, set status to doing/done using the new action tools).
  - [ ] Locale-aware system prompt; FR/EN toggle in ChatWidget header.
- Performance and robustness
  - [ ] Parallelize `fetchPreview` with `Promise.all` to build citations faster.
  - [ ] Add user-facing errors for OpenAI/Qdrant timeouts; no silent failures.
  - [ ] Deduplicate citations by `kind:id` and sort by score before rendering.
- Lightweight memory (Mongo)
  - [ ] Add `userPrefs` collection (favorite projects, recent filters, language preference).
  - [ ] Load prefs in `chat.ask` and inject into `buildSystemPrompt()` to personalize planning.
- Validation and safety
  - [ ] Strict server-side input validation for all tools (ISO dates, non-empty ids, enum statuses).
  - [ ] Uniform user error messages (short, clear), hiding internal details.
- Acceptance additions
  - [ ] Action tools require a confirmation step and produce an audit entry.
  - [ ] Answers that list tasks include total count and human-readable fields only (no internal ids).
  - [ ] Empty-plan prompts do not show a plan block; tool execution statuses appear only when steps exist.

### Acceptance

- Given "donne‑moi les tâches du projet data", the agent calls `chat_projectByName`, binds `projectId`, calls `chat_tasksByProject`, and returns tasks + total count.
- If the project does not exist, it stops with a concise message and suggests available projects.

### Current status (implemented)

- Working memory + argument binding between steps (e.g., projectId).
- Hard cap at 5 steps per plan (planner and fallback tool-calls).
- Single re‑plan when a required argument is missing, using a memory snapshot.
- Generic synthesis guidance (no task-specific fields).

### Design updates (prompt-first, generic planner)

- Prompt-first UX
  - No quick-actions required; all interactions via natural prompts. Optional discoverability elements can be considered later, disabled by default.
- RAG as a tool
  - Pre-planner semantic search disabled; retrieval should be exposed as a tool the planner can call when relevant.
- Generic planner architecture
  - Binding: resolve args from working memory generically (e.g., `{var:'ids.projectId'}`, `{var:'params.tag'}`).
  - Mapping: map tool outputs to memory via generic paths (e.g., toolOutput.path → memory.key), without domain-specific logic.
  - Stop conditions: prefer declarative `stopWhen` based on artifacts instead of hardcoded checks.
  - Unify execution for planner vs fallback (Responses API): same executor; fallback tool_calls adapted into steps.
- Tool contracts (incremental)
  - Standard output envelope `{ data, error?, warning?, meta? }`. Lists include `total`; response should avoid internal IDs in user-facing text.
  - Mutation tools require explicit confirmation and idempotency (future phases).
- Observability & errors
  - Structured per-step logs (args redacted), latency, output size, stop reason. Short, consistent user-facing errors.
- Testing approach
  - Unit: binding, mapping, cap 5 tool-calls.
  - Integration (with mocked OpenAI): two-step chain project-by-name → tasks-by-project; re-plan path on missing args.

## Future mutations

Here is a pragmatic, Planner-first prioritized proposal to cover "all" collections with coherent and generic tools.

### Priority 1 — Read-only (quick coverage, useful for the Planner)

See `TOOL_HANDLERS` for the effective list of read-only tools (tasks, projects, notes, links, people, teams, files, alarms) and `CHAT_TOOLS_DEFINITION` for model exposure.

### Priority 2 — Essential mutations (with confirmation)

- Tasks
  - [ ] chat_createTask({ projectId, title, deadline? }) [confirm]
  - [ ] chat_updateTaskStatus({ taskId, status }) [confirm]
  - [ ] chat_setTaskDeadline({ taskId, deadline }) [confirm]
  - [ ] chat_addTaskTag({ taskId, tag }) / chat_removeTaskTag({ taskId, tag }) [confirm]
- Projects
  - [ ] chat_createProject({ name, description? }) [confirm]
  - [ ] chat_updateProject({ projectId, fields }) [confirm]
- Notes
  - [ ] chat_createNote({ projectId, title?, content }) [confirm]
  - [ ] chat_createNoteSession({ projectId }) [confirm]
  - [ ] chat_appendNoteLine({ sessionId, content }) [confirm]
- Links
  - [ ] chat_createLink({ projectId, name, url }) [confirm]
- Alarms
  - [ ] chat_createAlarm({ title, when }) [confirm]
  - [ ] chat_toggleAlarmEnabled({ alarmId, enabled }) [confirm]
  - [ ] chat_snoozeAlarm({ alarmId, until }) [confirm]

### Conventions (for any new tool)

- Input
  - Strict validation (ISO dates, enums), no ambiguous optional fields.
  - Confirmation required for any mutation (confirmed: true).
- Output
  - Contracts are specified in the code (schemas/handlers). No duplication here.
- Standard memory (Planner-friendly)
  - lists.* for arrays (e.g. lists.tasks, lists.projects)
  - entities.* for unique objects (e.g. entities.project)
  - ids.* for identifiers (e.g. ids.projectId)
  - params.* for useful parameters (e.g. params.tag)
- stopWhen
  - Use artifacts ("lists.tasks", "entities.project", "ids.projectId"), not heuristics.

### Recommended implementation order

1. Read-only coverage: tasks, projects, notes, links (most requested by the Planner).
2. Semantic tool (already done) + search on notes/links if needed.
3. Task mutations (create/update/status/deadline/tags) with confirmation.
4. Note/link mutations (create/append), alarms (create/toggle/snooze).
5. People/teams/files/situations if needed by your prompts.

### Unit tests (to duplicate for each new tool)

- Memory mapping: lists.* / entities.* / ids.* filled correctly (and legacy compatibility if necessary).
- Argument validation (OK / KO).
- stopWhen: that the expected artifact correctly stops the executor.

## Security

- API keys are never stored client-side
- All sensitive operations are server-side only
- Health checks are cached to prevent excessive API calls
- Input validation on all server methods

## Model Compatibility

### Local Models (Ollama)

- **Chat**: `llama3.1:8b-instruct`, `mistral:7b-instruct`
- **Embeddings**: `nomic-embed-text` (768 dims), `all-MiniLM-L6-v2` (384 dims)

### Remote Models (OpenAI)

- **Chat**: `gpt-4o-mini`, `gpt-4o`
- **Embeddings**: `text-embedding-3-small` (1536 dims), `text-embedding-3-large` (3072 dims)

## Performance

- Health checks cached for 5 minutes
- Automatic timeout handling (30s default)
- Metal acceleration on Apple Silicon (M1/M2/M3)
- Efficient error handling without silent catches

## Troubleshooting

### Local Provider Issues

1. Ensure Ollama is running: `ollama serve`
2. Check model availability: `ollama list`
3. Verify health status in Preferences UI

### Remote Provider Issues

1. Verify API key is set correctly
2. Check network connectivity
3. Monitor rate limits and usage

### Vector Store Issues

1. Ensure Qdrant is running locally
2. Check vector dimensions match current model
3. Reindex if switching embedding models

## Future Enhancements

- Support for additional providers (Anthropic, Cohere)
- Streaming responses
- Custom model fine-tuning
- Advanced caching strategies
- Multi-modal support (images, audio)
