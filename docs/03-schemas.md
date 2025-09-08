# Data Schemas

This document lists the application's data collections and their key fields.
It is a high‑level reference; see code for full details and validation.

## Core Collections

- Projects (`projects`)
  - `_id`, `name`, `description`, `status`, `targetDate`, `progressPercent`,
    `riskLevel`, `createdAt`, `updatedAt`.
- Tasks (`tasks`)
  - `_id`, `projectId`, `title`, `status`, `deadline`, `estimate`, `actual`,
    `progressPercent`, `statusChangedAt`, `updatedAt`.
- Notes (`notes`)
  - `_id`, `projectId`, `title`, `content`, `createdAt`.
- Note Sessions (`noteSessions`) and Lines (`noteLines`)
  - Session: `_id`, `projectId?`, `createdAt`.
  - Line: `_id`, `sessionId`, `content`, `createdAt`.
- Links (`links`)
  - Link/bookmark entities used across the app.
- Alarms (`alarms`)
  - In‑app client‑scheduled alarms.
- Budget (multiple `budget*` collections)
  - Import and analytics entities for the Budget module.
- Search (external)
  - Qdrant collection `panorama` (vectors); see the Search section in
    `02-tech-notes.md` for configuration.

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
