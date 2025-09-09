# Feature: global AI chat

## Goal

Provide a global AI chat interface that can be used to ask questions about the workspace. The chat uses the vector database to be context-aware and relevant.

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

## Notes

- A temporary server stub `chat.ask` may return an echo response while the AI backend is WIP.

## Implementation notes

- Server:
  - Uses Responses API (no streaming) for the first pass; logs system/user prompts and response meta.
  - Executes tool calls and logs selectors/results size.
  - Uses Chat Completions for the final synthesis with `assistant.tool_calls` + `tool` messages; guidance forces using ONLY tool results and listing all items + total count.
  - System prompt includes the current date/time and timezone (e.g., `Current date/time: 2025-09-08T22:30:00.000Z (Europe/Paris)`).
- Retrieval uses Qdrant (embeddings: `text-embedding-3-small`). Top‑k results are returned as citations.
- History persistence: flat `ChatsCollection` storing individual messages for reload resilience.
- UI feedback: user message appears instantly; header shows "Sending…"; a temporary assistant "Thinking…" bubble is displayed while waiting.

## Tools (planned whitelist)

- projects.insert(name)
- projects.update(id, fields)
- tasks.insert({ projectId, title, deadline? })
- tasks.update(id, fields)
- chat.tasks(search)
- chat.overdue(now?)
- chat.tasksByProject(projectId)
- chat.tasksFilter({ status?, tag?, projectId? })
- notes.insert({ projectId, title?, content })
- noteSessions.insert({ projectId })
- noteLines.insert({ sessionId, content })
- links.insert({ projectId, name, url })

All tools must:

- be confirmed by the user before execution,
- validate inputs server-side,
- log an audit entry (tool name, inputs, result, timestamp).

### Tool: chat.tasks(search)

- Input: `{ dueBefore?: ISODateString, projectId?: string, status?: 'todo'|'doing'|'done' }`
- Server normalization:
  - If `dueBefore` is missing/invalid, set to local tomorrow 23:59:59.
  - Exclude completed tasks by default: `status != 'done'` (align with Panorama UI).
  - Deadline matches Date or string `YYYY-MM-DD` formats.
- Output: array of `{ _id|id, title, projectId, status, deadline }`.
- Synthesis: the final answer uses ONLY tool results and includes all tasks + total count.

### Tool: chat.overdue(now?)

- Input: `{ now?: ISODateString }` (optional; server defaults to current time)
- Behavior: returns non-completed tasks with deadline <= now (supports Date or `YYYY-MM-DD`).

### Tool: chat.tasksByProject(projectId)

- Input: `{ projectId: string }`
- Behavior: returns non-completed tasks for the project.

### Tool: chat.tasksFilter({ status?, tag?, projectId? })

- Input: `{ status?: string, tag?: string, projectId?: string }`
- Behavior: returns tasks filtered by simple attributes (no DB mutations).

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

- Given “donne‑moi les tâches du projet data”, the agent calls `chat_projectByName`, binds `projectId`, calls `chat_tasksByProject`, and returns tasks + total count.
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

## Chat

Here is a pragmatic, Planner-first prioritized proposal to cover "all" collections with coherent and generic tools.

Priority 1 — Read-only (quick coverage, useful for the Planner)

- Projects
  - [ ] chat_projectsList()
  - [ ] chat_projectByName(name)
  - [ ] chat_projectsSearch(query?, limit?)
- Tasks
  - [ ] chat_tasks({ projectId?, dueBefore?, status? })
  - [ ] chat_overdue({ now? })
  - [ ] chat_tasksByProject(projectId)
  - [ ] chat_tasksFilter({ status?, tag?, projectId? })
- Notes & Sessions
  - [ ] chat_notesByProject(projectId)
  - [ ] chat_noteSessionsByProject(projectId)
  - [ ] chat_noteLinesBySession(sessionId)
  - [ ] chat_notesSearch(query?, projectId?, limit?)
- Links
  - [ ] chat_linksByProject(projectId)
  - [ ] chat_linksSearch(query?, projectId?, limit?)
- People / Teams
  - [ ] chat_peopleList(filter?)
  - [ ] chat_teamsList(filter?)
- Files
  - [ ] chat_filesByProject(projectId)
  - [ ] chat_filesSearch(query?, projectId?, limit?)
- Alarms
  - [ ] chat_alarmsList({ enabled? })
- Situations (if used)
  - [ ] chat_situationsList({ projectId? })
  - [ ] chat_situationNotes(situationId)
  - [ ] chat_situationQuestions(situationId)
  - [ ] chat_situationSummaries(situationId)
- Semantic
  - [ ] chat_semanticSearch(query, limit?)

Priority 2 — Essential mutations (with confirmation)

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

Conventions (for any new tool)

- Input
  - Strict validation (ISO dates, enums), no ambiguous optional fields.
  - Confirmation required for any mutation (confirmed: true).
- Output (standard envelope)
  - { data, total?, error?, warning?, meta? }
  - No internal IDs in the user interface (useful only for memory chaining).
- Standard memory (Planner-friendly)
  - lists.* for arrays (e.g. lists.tasks, lists.projects)
  - entities.* for unique objects (e.g. entities.project)
  - ids.* for identifiers (e.g. ids.projectId)
  - params.* for useful parameters (e.g. params.tag)
- stopWhen
  - Use artifacts (“lists.tasks”, “entities.project”, “ids.projectId”), not heuristics.

Recommended implementation order

1) Read-only coverage: tasks, projects, notes, links (most requested by the Planner).
2) Semantic tool (already done) + search on notes/links if needed.
3) Task mutations (create/update/status/deadline/tags) with confirmation.
4) Note/link mutations (create/append), alarms (create/toggle/snooze).
5) People/teams/files/situations if needed by your prompts.

Unit tests (to duplicate for each new tool)

- Memory mapping: lists.* / entities.* / ids.* filled correctly (and legacy compatibility if necessary).
- Argument validation (OK / KO).
- stopWhen: that the expected artifact correctly stops the executor.

If you want, I can start by creating the missing Read-only batch (notes/links/people/teams/files/alarms) in the same vein as those already in place.
