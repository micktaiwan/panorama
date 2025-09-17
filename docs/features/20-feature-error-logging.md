# Feature: error logging and user feedback

This document describes how Panorama logs server errors related to vectorization and ensures users do not lose their input, along with how notifications are shown.

### Goals

- Never lose user data when server-side vectorization fails (e.g., OpenAI or Qdrant outage).
- Provide immediate user feedback via a toast notification.
- Persist diagnostic details in a centralized `Errors` collection to aid troubleshooting.

### Data model

- Collection: `errors`
- Fields:
  - `kind` (string): error category, e.g. `vectorization`.
  - `message` (string): human-readable message.
  - `context` (object): optional contextual info (e.g., `status`, `statusText`, `kind`, `id`).
  - `createdAt` (date): timestamp.

See `imports/api/errors/collections.js`.

### Publications and methods

- Publication `errors.recent`: returns last errors for introspection.
- Methods:
  - `errors.insert(doc)`: insert an error entry.
  - `errors.removeOld(days)`: housekeeping to prune old entries.

See `imports/api/errors/publications.js` and `imports/api/errors/methods.js`.

### Server integration

- Centralized logging in `imports/api/search/vectorStore.js`:
  - `embedText` logs OpenAI HTTP failures and invalid vectors to `Errors`.
  - `upsertDoc` wraps embedding + Qdrant upsert and logs failures to `Errors` with context `{ kind, id, hasProjectId, hasSessionId }`.
  - Primary writes (e.g., inserting note lines) are not blocked. The note line is saved even if vectorization fails.

### Client feedback (no console suppression)

- Global Notify handler wired in `imports/ui/App.jsx` via `setNotifyHandler`.
- `imports/ui/utils/notify.js` exposes `notify({ message, kind })`.
- Global error hooks in `imports/ui/utils/globalErrors.js` display a toast AND log to the browser console. We do not override or silence `console.error` on the client.
- In `NoteSession`, insert errors surface a toast and keep the input value, avoiding data loss:

```jsx
Meteor.call('noteLines.insert', { sessionId, content }, (err) => {
  if (err) {
    notify({ message: 'Failed to save note line. Data kept. Check connection.', kind: 'error' });
    setInputValue(prev);
    return;
  }
  setInputValue('');
});
```

### Notes

- Vectorization DEBUG mode can be enabled in `vectorStore.js` to avoid external calls during development.
- Errors collection is loaded on server startup in `server/main.js`.
- Server console errors are persisted via `imports/api/errors/serverConsoleOverride.js`, which forwards to the original console. We do not hide or replace server console output.
- Future: add an Errors admin page to inspect and clear entries.
