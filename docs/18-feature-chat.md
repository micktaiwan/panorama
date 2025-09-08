# Feature: global AI chat

## Goal

Provide a global AI chat interface that can be used to ask questions about the workspace. The chat uses the vector database to be context-aware and relevant.

## Scope (MVP)

- UI: popup button in the bottom right corner of the screen (open on click).
- UI: a chat interface with a text input and a send button.
- AI: use OpenAI Chat Completions API (`model: o4-mini`).
- use Qdrant for vector search.
- Follow the same client pattern for OpenAI usage as other features
