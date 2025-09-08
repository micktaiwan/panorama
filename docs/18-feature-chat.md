# Feature: global AI chat

## Goal

Provide a global AI chat interface that can be used to ask questions about the workspace. The chat uses the vector database to be context-aware and relevant.

## Scope (MVP)

- UI: popup button in the bottom-right corner of the screen (open on click).
- UI: chat interface with a text input. Enter to send; Shift+Enter for newline. No send button.
- UI: dark theme. Two layouts: floating bubble and docked right sidebar.
- UI: keyboard shortcuts — ⌘D: toggle open/close; ⌘⇧D: toggle docked vs bubble (opens when docking).
- AI: use OpenAI Chat Completions API (`model: o4-mini`).
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
