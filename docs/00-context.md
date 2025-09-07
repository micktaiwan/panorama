# Project Context

Related docs:

- [Roadmap](./01-roadmap.md)
- [Tech notes](./02-tech-notes.md)
- [Feature: text2task](./10-feature-text2task.md)

## Panorama Project

- Codename: **Panorama**.
- Goal: Build a project management tool that provides a global overview of
  all lempire/lemlist projects and responsibilities across teams.
- lemlist (without uppercase) is a Sales Engagement Platform (SEP). Panorama is an internal CTO tool to keep clarity on what matters and to track progress.

## Users and Roles

- Primary user: CTO (multi-team scope: Dev, Data, SRE, DevOps, etc.).
- Secondary users: none for MVP; team leads may be added later.

## Problem Statement

- Need for a clear, hierarchical overview (projects → tasks) without Kanban.
- Consolidate meeting notes and decisions per project.
- Generate automatic AI summaries to surface what matters and next steps.
- need for a clear dashboard to track progress and status of projects

## Objectives

- Maintain a trustworthy overview of active projects and personal/pro work.
- Track tasks with deadlines, progress percentage, status, and risk.
- Capture notes in meetings and summarize on-demand with AI.
- Keep people context organized via in‑app Teams (MVP) and, later, in sync via lemlist team users.

## MVP Scope (Local-only to start)

- Manual data entry for Projects, Tasks, and Notes.
- No external automations initially. Optional cron jobs may later compute
  progress and produce a daily recap.
- English UI. No Kanban view; focus on list and detail pages.
- Three-pane note-taking interface: Context | Notes | AI (keyboard-first).
- AI summarization and coaching are on-demand (not automatic per keystroke).

### Initial Data Model

- Project: id, name, description, priority, status (planned/active/blocked/done),
  startDate, targetDate, progressPercent, riskLevel, links (Notion/GitHub),
  updatedAt.
- Task: id, projectId, title, status, dueDate, estimate, actual, progressPercent,
  notes, updatedAt.
- Note: id, projectId, content, createdAt, aiSummary.
- NoteSession: id, projectId (optional), createdAt.
- NoteLine: id, sessionId, content, createdAt.

### Views

- Dashboard: high-level stats and signals (e.g., blockers, stale updates,
  upcoming deadlines).
- Projects list: compact table with key fields (status, progress, targetDate,
  risk).
- Project details: overview, tasks, notes with AI summary.
- Note Session: two-column layout (Context | Notes) with AI section below the notes.

## Integrations

- Lemlist API: acceptable later; not used in MVP.
- Notion: future import of projects and tasks (no integration in MVP).

## Automation and Notifications (Later)

- Optional cron jobs to compute progress and produce daily recaps.
- In-app daily recap view first; email digests may come later.

## UX Guidelines

- English UI copy. Prioritize clarity and dense information over boards.
- Hierarchical navigation: Projects → Tasks → Notes.
- Keyboard-first navigation. Enter commits a line; Shift+Enter for newline.
- Optional inline tags (e.g., #risk, #decision) are nice-to-have, not priority.

## Tech Notes

- Stack: Meteor + React (local-only, not intended for deployment).
- Data: local Meteor Mongo. Secrets (lemlist token) via Meteor settings file.
- LLM: cloud acceptable.

## Note Sessions and AI

- On-demand AI: user triggers summarization and coach questions.
- Context assembly: combine project metadata and the most recent note lines;
  start with recency and lightweight heuristics.
- Vector database: optional later. If context exceeds token limits, consider a
  small embedding index to retrieve relevant lines.
- Coach: ask up to three high-signal questions (scope, dependencies, deadlines,
  next steps). Keep noise low; user can dismiss/snooze.
- Sessions: one session per meeting.
- Lifecycle: after recap is finalized and tasks/risks are created and
   validated by the user, delete the session lines to keep streams clean.
- Standalone sessions: a note session can start without a project and be
   linked to a project later.

## Meta actions

- user can have a prompt that says: create a new project and scaffold some tasks for this project

## Developer Guidelines

- Follow "Ship value fast": build an MVP quickly.
- For inter-service data (e.g., team users), use the lemlist API.
