# Technical Notes

## App scope and authentication

- Local, single-user app. No Accounts/auth in MVP.
- Publications should not rely on `this.userId`; publish needed data without user filtering.
- Meteor methods must not assume an authenticated user; validate inputs and operate without user context.
- If multi-user support is added later, reintroduce auth checks and per-user selectors.

## Note Session UI

- Keyboard
  - Enter commits a line and prepares a new empty line ready to type.
  - Shift+Enter inserts a newline without committing.
  - Esc has no effect in note capture mode (no cancel).

## Inline editing (for example: Projects, Tasks, Notes)

- Creation
  - An input is provided to enter the initial text for the item.
  - Submitting the input (Enter) creates the database entry.

- Editing
  - Field values are rendered as plain text by default.
  - Clicking on the text turns it into an input pre-filled with the current
    value and focuses it.
  - Pressing Enter validates and persists the edition to the database.

- Scope
  - This behavior applies to simple text fields across `Project`, `Task`, and
    `Note` entities.

## API Structure

See also: Schemas reference in `03-schemas.md` (includes Teams and People.teamId).

- Each resource under `imports/api/` must live in its own directory with:
  - `collections.js` — defines the Mongo collection(s)
  - `methods.js` — Meteor methods for CRUD and actions
  - `publications.js` — Meteor publications for the resource
- Example:
  - `imports/api/projects/collections.js`
  - `imports/api/projects/methods.js`
  - `imports/api/projects/publications.js`
- The server must import each resource’s three files in `server/main.js`.

### Collections

The detailed list of collections and fields is maintained in `03-schemas.md`.

## Semantic Search (Qdrant)

- Vector store: Qdrant (local binary or Docker). Access via `@qdrant/js-client-rest`.
- Meteor server talks to Qdrant over HTTP (no tight coupling).
- Settings: `Meteor.settings.qdrantUrl` points to the Qdrant endpoint.
- Store embeddings for: Projects, Tasks, Notes, Note Sessions, Note Lines, Alarms.
- Provide a `VectorStore` abstraction to allow backend swaps later.
- Generate embeddings in background (`Meteor.defer()`/workers) to avoid blocking methods.
- Vector dimension: the Qdrant collection `vectors.size` must exactly match the embedding model dimension (e.g., 1536 for `text-embedding-3-small`).
- Payload conventions: include at least `{ projectId, kind }` so results can be filtered/grouped and exports can be reconstructed.

### VectorStore and live update rules

- Abstractions (server)
  - `imports/api/search/vectorStore.js`
    - `toPointId(kind, id)` → stable point id
    - `makePreview(text, max)` → short snippet used in UI
    - `embedText(text)` → embedding (DEBUG can mock); query‑time LRU cache is implemented in search method
    - `upsertDoc({ kind, id, text, projectId?, sessionId?, extraPayload? })` → upsert in Qdrant
    - `deleteDoc(kind, id)` / `deleteByProjectId(projectId)` / `deleteBySessionId(sessionId)`
- Update rules (apply uniformly to all collections):
  - Create/Update: compute `text` and payload, then `upsertDoc` (no delete needed; upsert overwrites)
  - Delete: `deleteDoc(kind, id)`; for container removals also filter‑delete by `projectId`/`sessionId` when relevant
- New collections: add a registry entry (kind, fields, how to build `text`, meta extraction) and call `upsertDoc/deleteDoc` in their methods.

### Qdrant installation (step-by-step)

1. Install Docker (or use native binaries from Qdrant releases).
2. Start Qdrant locally:

   ```bash
   docker run --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant
   ```

3. Verify the HTTP API is up:

   ```bash
   curl http://localhost:6333/healthz
   # -> { "status": "ok" }
   ```

4. Configure the app settings:

   - In `settings.json`, add:

     ```json
     {
       "qdrantUrl": "http://localhost:6333"
     }
     ```

   - Start Meteor with settings (Cursor dev already does this):

     ```bash
     meteor run --settings settings.json
     ```

5. Install the JS client in the project (server-side usage):

   ```bash
   npm install @qdrant/js-client-rest
   ```

6. Create the `panorama` collection once (dimension must match your embedding model):

   ```javascript
   import { QdrantClient } from '@qdrant/js-client-rest';
   import { Meteor } from 'meteor/meteor';
   const client = new QdrantClient({ url: Meteor.settings.qdrantUrl || 'http://localhost:6333' });
   await client.createCollection('panorama', { vectors: { size: 1536, distance: 'Cosine' } });
   ```

7. Upsert and search using the client from Meteor methods (HTTP calls; no special Meteor glue required).

Optional: docker-compose

```yaml
services:
  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant-data:/qdrant/storage
volumes:
  qdrant-data:
```

### Import/Export parity

- Exports should preserve stable ids and payload fields (`projectId`, `kind`).
- On import, prefer re-computing embeddings for correctness; alternatively restore vectors only if dimensions match the configured collection size.

### Async Collection API

- Use async collection methods on the server:
  - `insertAsync`, `updateAsync`, `removeAsync`, `findOneAsync`, `countAsync`.
- Meteor methods should be `async` and `await` these calls, returning IDs or
  counts as needed. Do not use the sync variants on the server.

## UI Component Structure and Styles

- Each UI component lives in its own directory under `imports/ui/`:
  - `ComponentName/ComponentName.jsx` — component implementation (no index indirection)
  - `ComponentName/ComponentName.css` — component-scoped styles at the root of the component directory
- Components must NOT use inline styles. Prefer CSS classes
  and the per-component stylesheet
- Avoid inline styles anywhere; prefer component-level CSS

### Factorization and co-location (strict rules)

- Business/UI logic for a given element must live in a single reusable component.
  - Example: task display, editing (status/title/deadline), Eisenhower toggles and actions are centralized in `imports/ui/components/TaskRow/TaskRow.jsx` with styles in `TaskRow.css`.
  - Pages (e.g., `ProjectDetails.jsx`, `Eisenhower.jsx`) compose `TaskRow` instead of re‑implementing rows.
- Styles are co‑located with their component. Do not define component styles in page CSS files.
  - Only page‑specific layout wrappers (grids, margins around sections) belong to page CSS.
- When a component needs minor visual variations, use props (e.g., `textSize`, `inlineActions`, `editableDeadline`) rather than forking markup.
- Shared look & feel (tokens/utilities) stays in `client/main.css` (e.g., `.eisenhowerToggle`, `.scrollArea`, colors, spacing).

### Page composition guidelines

- Pages can wrap reusable components with drag‑and‑drop or page context, but must not duplicate inner logic:
  - `ProjectDetails.jsx` keeps DnD in a lightweight wrapper around `TaskRow` (no re‑implementation of row internals).
  - Any future list (e.g., search results) must use the same `TaskRow` to keep behavior consistent.

### Dashboard structure

- Dashboard is an umbrella component and renders two sections:
  - `ProjectsOverview` (primary, full-width): Signals strip and projects table (status, progress, target severity, risk, open tasks, last update, quick open action).
  - `TasksOverview` (secondary): cross-project tasks list (due soon/overdue by default).
- Legacy `ProjectsList` sidebar is deprecated and removed from Home (kept in codebase for potential reuse/documentation).

### Card pattern (shared container)

- Purpose: provide a consistent container for content blocks (padding, border, radius, background).
- Implementation:
  - Component: `imports/ui/components/Card/Card.jsx` with stylesheet `Card.css`.
  - API: `Card({ title, actions, className, children })`.
  - Header is optional. When `title` or `actions` is provided, a header row is rendered.
- Usage examples:
  - Note Session AI summary: `Card` wrapping rendered Markdown.
  - Note Session Coach: `Card` wrapping the list of questions.
- Do NOT put Markdown-specific styles in Card. Keep them in a `.markdown` or targeted class (e.g., `.aiMarkdown`).
- Spacing between stacked cards: use adjacent sibling spacing (e.g., `.card + .card { margin-top: 16px; }`).

### Spacing tokens and rules

- Use a consistent scale: 8, 12, 16, 24.
- Prefer component-level margins
- Keep consistent separation from global footer: ensure the last section has a bottom margin (e.g., 24px).

### Scroll containers and overscroll behavior

- Do not allow scroll chaining. Scrollable areas must not propagate scroll to the page when they reach their edge.
- Use the global utility class `.scrollArea` for all scrollable containers. This class enforces `overscroll-behavior: contain` and consistent thin dark scrollbars.
- Do not re‑implement per‑component scrollbar styles; rely on the shared utility.
- Example:

```jsx
<div className="scrollArea" style={{ maxHeight: 360 }}>
  {/* long content */}
</div>
```

The utility is defined in `client/main.css` and currently includes:

```css
.scrollArea { overflow: auto; overscroll-behavior: contain; }
.scrollArea { scrollbar-width: thin; scrollbar-color: #2a2f3a #12141a; }
.scrollArea::-webkit-scrollbar { width: 8px; height: 8px; }
.scrollArea::-webkit-scrollbar-track { background: #12141a; }
.scrollArea::-webkit-scrollbar-thumb { background-color: #2a2f3a; border-radius: 8px; border: 2px solid #12141a; }
```

## Routing

- Access to pages MUST be done via a route
- Navigation must set the hash to the appropriate route; components read params
  from the router to fetch data

## Shortcuts (and Help page)

- Enter — validate inline edits
- Shift+Enter — validate a task title AND create/focus a new task
- InlineEditable: unified submitOnEnter behavior for input/textarea/select; Escape cancels.
- Click on deadline — open datepicker, Esc cancels, Enter validates

The Help page (`#/help`) must be updated when a new shortcut is added.

## React/Meteor Data Hooks

- Always respect Rules of Hooks: never call hooks conditionally and keep order stable.
- Hooks order stability:
  - Declare `useState`/`useMemo`/`useEffect` (and other hooks) at the top-level of the component, not inside conditionals/loops/returns.
  - When adding a new hook later, place it alongside existing hooks to avoid shifting the hook order between renders.
  - Never create hooks inside render-time branches (e.g., `if (...) { useState(...) }`). Prefer guards in effects or derive from existing state.
- For Meteor reactive finds that return one document, use the helper hook:
  - `useSingle(getCursor)` → wraps `useFind` and returns the first document.
  - Example: `const project = useSingle(() => ProjectsCollection.find({_id}))`.
- When a selector may be absent, pass a neutral selector (e.g., `{ _id: '__none__' }`) to keep hook order consistent
- Example usage in a component:

```javascript
import { useSingle } from '/imports/ui/hooks/useSingle.js';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

export const Example = ({ sessionId }) => {
  // Stable order: always call hooks in the same sequence
  const session = useSingle(() => NoteSessionsCollection.find({ _id: sessionId }));
  const project = useSingle(() =>
    ProjectsCollection.find(session && session.projectId ? { _id: session.projectId } : { _id: '__none__' })
  );
  return <div>{project ? project.name : 'No project linked'}</div>;
};
```

## Error handling policy

- Avoid silent `try/catch` blocks. Never write `catch (_e) {}`.
- If a `try/catch` is necessary, always:
  - log the error (use console.error on the server side / display a message on the UI side),
  - or re-throw an explicit error (e.g., `throw new Meteor.Error(...)`).
- Prefer simple guards over `try/catch` (check for the presence of methods and objects).

## Notifications and confirmations (UI)

- Do not use `window.alert` or `window.confirm`.
- Use app-level components:
  - Modal (confirm dialog): `imports/ui/components/Modal/Modal.jsx` (+ `Modal.css`)
    - API: `<Modal open onClose title actions className>children</Modal>`
    - Behavior: focus trap via browser defaults, closes on ESC and overlay click, header shows title and close icon, footer renders passed action buttons (Cancel primary, Destructive secondary).
    - Style: panel background `var(--panel)`, borders `var(--border)`, radius `var(--radius)`; no inline styles.
  - Notify (toast): `imports/ui/components/Notify/Notify.jsx` (+ `Notify.css`)
    - API: `<Notify message kind onClose durationMs />` with kinds `info|success|error`.
    - Behavior: fixed bottom-right, auto-dismiss after `durationMs`, close button available.
- Copy guidelines: concise, action-led. Confirmations must state the irreversible nature when applicable.

## String normalization (server)

- Trim short text fields at save time, never at display time.
- Apply on server methods for entities like `Project.name`, `Task.title`, `Note.title`, `NoteSession.name`, `Alarm.title`.
- Do not trim rich text/markdown `content` fields; preserve user spacing.
- Rationale: predictable data, simpler UI rendering (`value` is already normalized).

### Shared string helpers

- UI: `imports/ui/utils/strings.js` exports `normalizeString`, `toOneLine`.
- Server: `imports/api/_shared/strings.js` exports the same helpers (no isomorphic coupling).

### Deep-link highlight pattern

- Use `useHashHighlight(paramKey, clearToHash)` to consume hash params once and normalize the URL.
- Use `useRowHighlight(id, selector, onClear)` to scroll into view and fade highlight.

### Situation Analyzer prompt helpers

- `imports/api/situations/promptHelpers.js` centralizes LLM JSON schemas and helpers:
  - `buildKnownPeopleCatalog`, `buildRosterForQuestions`, `buildRosterForSummary`, `buildPriorBlock`, `buildNotesByActorBlock`, `logOpenAiPayload`.

## Collapsible component

- Use `imports/ui/components/Collapsible/Collapsible.jsx` (+ `Collapsible.css`) to show hideable sections (e.g., project notes list rows).
- API: `<Collapsible title defaultOpen open onToggle className>children</Collapsible>`.
- Behavior: header is a button with caret `▶/▼`, toggles open/close; `open` can be controlled or uncontrolled via `defaultOpen`.
- Accessibility: header uses `aria-expanded` and `aria-controls`.
- Styling: keep header compact; avoid inline styles; margins controlled by parent.

## In-app Alarms (client scheduler)

- Scope: in-app only (MVP). Alarms trigger when the Panorama tab is open. See `docs/12-feature-alarms.md` for feature spec and roadmap.
- UI: use `Modal` for the firing popup (Snooze/Dismiss); optionally `Notify` for lightweight info states. No inline styles.
- Data: alarms stored in `AlarmsCollection`. Client updates schedule on insert/update/remove/toggle.

### Scheduling strategy

- Primary: schedule the nearest alarm using `setTimeout(nextTriggerAt - now)`.
- Fallback: maintain a 60s tick to detect missed triggers when timers are throttled.
- Resume handling: on `visibilitychange` (becoming visible) and on app start, run a catch-up check to fire any past-due alarms once.
- Recurrence: after firing, compute next occurrence and update `nextTriggerAt` (see `computeNextOccurrence`). If non-recurring, disable or remove.
- Snooze: set `snoozedUntilAt`; scheduler uses this as the next effective trigger.

### Multi-tab coordination

- Ensure only one active scheduler per browser profile:
  - Prefer `BroadcastChannel('alarms')` to elect a leader; fall back to `localStorage` heartbeat if unsupported.
  - Non-leader tabs do not schedule timers; they still update UI reactively.
  - If leader closes or is suspended, another tab claims leadership after a grace timeout.

### Reliability and correctness

- On startup and resume, perform a catch-up: find alarms with `nextTriggerAt <= now` (or `snoozedUntilAt <= now`) and trigger them once.
- Make triggers idempotent: guard by alarm id and last-fired timestamp to avoid double firing across tabs.
- Time zone: use JS `Date` consistently; do not assume server time. Future enhancement may sync drift.

### Accessibility and UX

- Modal focus should land on the primary action; provide keyboard shortcuts for common snoozes (+5m/+10m/+15m).
- Announce via ARIA when an alarm fires; keep interactions simple and non-blocking.

### Sound (optional, later)

- Off by default; controlled by a settings toggle.
- Audio playback requires prior user interaction in most browsers; unlock and preload after the first click/keypress.
- If playback is blocked, log a warning and continue without sound. Do not throw.

### Error handling and hooks

- Avoid silent catches; log errors (console.error on server; surfaced errors or console.warn on client when non-fatal).
- Keep hooks order stable. If using a scheduler hook (e.g., `useAlarmScheduler`), declare at the top level of the app shell; never conditionally mount/unmount based on data presence—guard inside the effect logic instead.
