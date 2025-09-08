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
- use Qdrant for vector search.
- Follow the same client pattern for OpenAI usage as other features
- the agent should be able to perform actions (create projects, tasks, notes, etc.)
  - implement function calling with OpenAI.
  - the agent should always confirm actions with the user

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
