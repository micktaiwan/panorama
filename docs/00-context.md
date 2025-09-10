## Overview — Light Context

Useful Links:

- [Roadmap](./01-roadmap.md)
- [Tech notes](./02-tech-notes.md)
- [Feature: text2task](./10-feature-text2task.md)

This document provides a quick overview. The code is the main documentation and the only source of truth.

## Objective & Scope

- Global view of lemlist projects and team responsibilities
- Track tasks, risks, and progress; capture meeting notes
- On-demand AI summaries/coaching to identify next steps
- Local-only MVP, keyboard-first, list/detail views (no Kanban)

## User

- Primary: CTO (multi-team scope). Other roles possible later.

## Problem to Solve

- Clear hierarchy (Projects → Tasks) without boards
- Centralize notes/decisions by project
- Quickly see signals (blockers, deadlines, staleness)

## Goals

- Reliable portfolio of ongoing work (personal and teams)
- Tasks with deadlines, status, progress, and risk
- Quick note-taking; on-demand AI synthesis
- People context via in-app Teams

## MVP (local-only)

- Manual CRUD: Projects, Tasks, Notes
- UI in English; lists/details
- Notes in 3 panels: Context | Notes | AI (keyboard-first)
- No initial automations; potential cron/daily recap later

## Data Model (concise)

- Project: name, description, priority, status, dates, progress, risk, links
- Task: projectId, title, status, dueDate, estimate/actual, progress, notes
- Note: projectId, content, createdAt, aiSummary
- NoteSession/NoteLine: container session + lines for quick entry

## Main Views

- Dashboard: key signals (blockers, deadlines, staleness)
- Projects list: compact table
- Project details: overview, tasks, notes + AI synthesis
- Note Session: Context | Notes | AI

## AI & Search

- On-demand summary and coaching (a few high-signal questions)
- Context: project metadata + recent note lines
- Optional Vector DB later if needed

## Automation (later)

- Optional cron for progress and daily recap; first in-app then email

## UX Principles

- Clarity > boards; dense and scannable lists
- Hierarchical navigation; keyboard-first (Enter = commit, Shift+Enter = newline)

## Tech (high level)

- Stack: Meteor + React, local Mongo
- Secrets via Meteor settings; LLM possible in cloud

## Meta

- Prompt idea: "Create a new project and outline some tasks."
