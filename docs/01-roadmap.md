# MVP Roadmap

## Milestone 1: Foundation

- [x] Define data models: `Project`, `Task`, `Note` (no people for MVP).
- [x] Create Meteor collections and schema validation (lightweight).
- [x] Basic navigation and layout (English UI).
- [x] Three-pane Note Session view (Context | Notes | AI), keyboard-first.
- [x] Support standalone Note Sessions (no project), and link to project later.
- [x] Publications and Methods only (no insecure/autopublish).
- [x] Hash-based router with routes: `/`, `/projects/:projectId`, `/sessions/:sessionId`.

## Milestone 2: Core Features

- [x] Projects list view (compact table with status, progress, target).
- [x] Project details view (overview, tasks, notes, sessions list).
- [x] Create/edit Project and Task (manual input, no sync).
- [x] Notes editor for meetings (fast capture).
- [x] Project delete route with cascade removal and pre-delete counts.
- [x] Dashboard improvements: inline edit task title, delete task (icon), fixed project column width, project color flag.
- [x] Project color label: add color picker on Project page; store as `colorLabel`.
- [x] Standalone Note Sessions listed on Dashboard with open links.
- [x] Notes UX on Project page: larger edit textarea; show created time as time-ago + absolute.
- [ ] Compute project progress from tasks (aggregation logic).
- [ ] Risk and priority fields (simple enums) visible in list/detail.
- [x] Dashboard refactor: full-width, ProjectsOverview as primary, TasksOverview secondary.
- [x] Signals strip (Active/Blocked/Due≤7d/Stale) and projects table (status, progress, target severity, risk, open tasks, last update).
- [ ] Semantic Search (Qdrant)
  - [ ] Generate embeddings for existing data (projects, tasks, notes, sessions, lines, alarms).
  - [ ] Store vectors in Qdrant `panorama` collection with filters.
  - [ ] Meteor method `panorama.search` querying Qdrant.
  - [ ] Search bar UI with natural-language queries (typo tolerant).
  - [ ] AI mode toggle (agent answers with contextual references).
- [ ] Auto-update project.status (derived rules) — proposal:
  - blocked: if any blocking condition is detected (later, task flag)
  - active: default when activity is present (recent updatedAt)
  - planned: no activity (no tasks/notes/sessions) and no target date started
  - done: explicit user action or 100% tasks done + recent confirmation

## Milestone 3: AI (On-demand)

- [x] Add AI summary generation for notes and project status.
- [x] Grounded summaries: use only notes, add line-number citations, temp=0.
- [x] Store `aiSummary` with the session.
- [x] Coach questions grounded with line citations; JSON-validated output.
- [x] Numbered note lines in session UI (L1, L2, ...).
- [x] Text→Tasks import page (`#/import-tasks`): JSON schema extraction, project suggestion/inline create, per-line save.
- [x] Finalize as Note: save recap (or lines fallback) as a project note.
- [x] Include project context (name — one-line description, status, target) in Coach and Summarize prompts when linked; noop for standalone.
- [x] Coach enhancements: carry previous items as context; generate Questions, Ideas, Answers (JSON) with citations; UI renders all three.
- [x] Session UX: Clear Coach button; Reset session (clears lines, coach, summary) with confirmation; disable Coach/Summarize when no lines; Finalize disabled without project + explanatory tooltip; link standalone session to a project from the session page.
- [x] Server robustness: explicit error logs for OpenAI failures; block summarize on empty session.
- [ ] Add "Summarize latest updates" action on Project details.
- [ ] Coach questions (limit 3 concurrent; accept/snooze/dismiss).
- [ ] (Optional later) JSON-structured summary with citations; render to Markdown client-side.

## Milestone 4: People (lemlist)

- [ ] Configure secret management for lemlist token (Meteor settings file).
- [ ] Fetch team users from lemlist API (read-only import).
- [ ] Map `assigneeId/ownerId` to imported `Person` records.

## Milestone 5: Reporting

- [x] Dashboard with key signals (blockers, stale updates, deadlines soon).
- [ ] Optional daily recap job (cron) to compute and persist recaps (no notifications for now).
- [ ] (Optional later) Email digest sending from stored recap.

## Technical Checklist

- [ ] Respect error-handling rule: avoid try/catch unless necessary; never
      silent-catch.
- [ ] Keep secrets out of code; use environment variables.
- [ ] Keep lines reasonably wrapped and headings spaced in docs.
- [ ] Qdrant service documented and configured via `QDRANT_URL`.
- [ ] Add lightweight utilities for enums and date handling.
- [ ] Keyboard-first shortcuts (Enter commit, Shift+Enter newline).

## Out of Scope (MVP)

- [ ] Kanban boards.
- [ ] Notion/GitHub/Jira integrations (plan for later).
- [ ] Real-time notifications.
