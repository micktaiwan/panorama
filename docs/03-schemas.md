# Data Schemas

This document lists the application's data collections and their key fields.
It is a high‑level reference; see code for full details and validation.

## Multi-tenancy

Since Phase 2 (Feb 2026), all **remote collections** have a `userId` field for multi-user isolation. Every insert adds `userId`, every publication filters by `userId`, and every update/remove verifies ownership via `ensureOwner()`.

**Auth helpers** (`imports/api/_shared/auth.js`):
- `ensureLoggedIn(userId)` — throws `not-authorized` if falsy
- `ensureOwner(collection, docId, userId)` — throws `not-found` if doc doesn't belong to user
- `ensureLocalOnly()` — throws `local-only` if `PANORAMA_MODE === 'remote'`

**Remote collections** (have `userId`): projects, tasks, notes, noteSessions, noteLines, links, files, userPreferences.

**Local-only collections** (have `ensureLocalOnly()` guard): all others (situations, budget, calendar, chats, userLogs, emails, claude*, mcpServers, alarms, people, teams, errors, notionIntegrations, notionTickets).

## Core Collections (Remote)

- Projects (`projects`)
  - `_id`, `userId`, `name`, `description`, `status`, `targetDate`, `progressPercent`,
    `riskLevel`, `createdAt`, `updatedAt`.
  - Index: `{ userId: 1 }`
- Tasks (`tasks`)
  - `_id`, `userId`, `projectId`, `title`, `status`, `deadline`, `estimate`, `actual`,
    `progressPercent`, `statusChangedAt`, `updatedAt`.
  - Indexes: `{ userId: 1, projectId: 1 }`, `{ userId: 1, done: 1 }`
- Notes (`notes`)
  - `_id`, `userId`, `projectId`, `title`, `content`, `createdAt`.
  - Index: `{ userId: 1, projectId: 1 }`
- Note Sessions (`noteSessions`) and Lines (`noteLines`)
  - Session: `_id`, `userId`, `projectId?`, `createdAt`.
  - Line: `_id`, `userId` (denormalized), `sessionId`, `content`, `createdAt`.
  - Indexes: `{ userId: 1, projectId: 1 }` (sessions), `{ userId: 1, sessionId: 1 }` (lines)
- Links (`links`)
  - `_id`, `userId`, `projectId`, `name`, `url`, `clicks`, `createdAt`.
  - Index: `{ userId: 1, projectId: 1 }`
- Files (`files`)
  - `_id`, `userId`, `projectId`, `name`, `storedFileName`, `createdAt`.
  - Index: `{ userId: 1, projectId: 1 }`
- User Preferences (`userPreferences`)
  - `_id`, `userId`, `theme`, `openaiApiKey`, `anthropicApiKey`, `perplexityApiKey`, `ai` (mode, fallback, timeoutMs, maxTokens, temperature, local, remote), `createdAt`, `updatedAt`.
  - Index: `{ userId: 1 }` (unique)
  - Per-user settings. See also `appPreferences` for instance-level config.

## Local-Only Collections

- Alarms (`alarms`)
  - In‑app client‑scheduled alarms.
- Budget (multiple `budget*` collections)
  - Import and analytics entities for the Budget module.
- App Preferences (`appPreferences`)
  - Instance-level config (singleton): `filesDir`, `qdrantUrl`, `devUrlMode`, `localUserId`, `pennylaneBaseUrl`, `pennylaneToken`, `slack`, `googleCalendar`, `calendarIcsUrl`, `cta`.
- Search (external)
  - Qdrant collection `panorama` (vectors); see the Search section in
    `02-tech-notes.md` for configuration.
  - **Note**: Qdrant index is currently global (no userId in payloads). Phase 7 will add per-user isolation.

## Situation Analyzer

- People (`people`)
  - Global directory of persons, reusable across modules.
  - Fields: `_id`, `name`, `lastName`, `normalizedName`, `aliases[]`, `role`, `email`, `notes`, `left`, `teamId?`, `createdAt`, `updatedAt`.
- Situations (`situations`)
  - Situation container.
  - Fields: `_id`, `title`, `description`, `createdAt`, `updatedAt`.
- SituationActors (`situation_actors`)
  - Join between `situations` and `people` with a situation‑scoped role.
  - Fields: `_id`, `situationId`, `personId`, `name`, `role` (company role snapshot), `situationRole` (role in the situation), `createdAt`, `updatedAt`.
  - Constraint: unique index on `{ situationId, personId }`.
- SituationNotes (`situation_notes`)
  - Notes captured for the situation (optionally tied to a specific actor join).
  - Fields: `_id`, `situationId`, `actorId?`, `content`, `createdAt`.
- SituationQuestions (`situation_questions`)
  - Generated questions per actor.
  - Fields: `_id`, `situationId`, `actorId`, `questions` (array of
    `{ q: string, r: string }`), `createdAt`.
- SituationSummaries (`situation_summaries`)
  - Generated plain text summary/action plan.
  - Fields: `_id`, `situationId`, `text`, `createdAt`.

## Teams

- Teams (`teams`)
  - Team directory used to group People.
  - Fields: `_id`, `name`, `createdAt`, `updatedAt`.

Constraints/Rules:

- People can reference a team via `People.teamId`.
- Team deletion is guarded server‑side: cannot remove a team with members. Use `teams.removeAndReassign(teamId, newTeamId?)` to reassign members or clear their team.

### Styling/UX notes

- People marked `left: true` display with a dark grey row background and italic, muted text in the People page.

## Indexing (guidelines)

- Use unique indexes for natural keys (e.g., `people.normalizedName`).
- Add query indexes for common selectors (e.g., `{ situationId }`).
- Keep compound unique constraints for join tables (e.g.,
  `situation_actors: { situationId, personId }`).
