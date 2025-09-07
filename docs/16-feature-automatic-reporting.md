# Feature: Automatic Reporting (Activity Feed + AI Summary)

## Goal

Provide a dedicated reporting view that lists recent activity across the workspace and can be summarized by AI to produce a concise status report for leadership.

## Scope (MVP)

- Time window selector: 24h, 72h, last 7 days.
- Activity types:
  - Projects created
  - Tasks marked done (based on `statusChangedAt` when status becomes `done`)
  - Notes created
- Sorted newest first, grouped by category in the UI.
- Route: `#/reporting`.
- Export: one-click AI summary that generates Markdown from the structured events.

## Data sources

- `ProjectsCollection` — `createdAt`
- `TasksCollection` — `status: 'done'` and `statusChangedAt`
- `NotesCollection` — `createdAt`

## API

- `reporting.recentActivity(windowKey: '24h'|'72h'|'7d') → { since, until, events[] }`
- `reporting.aiSummarizeWindow(windowKey) → { markdown }`

## UI

- Component: `imports/ui/Reporting/ReportingPage.jsx` + `ReportingPage.css`
- Toolbar: selector + refresh, shows window range.
- Content: grouped lists with timestamp and title (project context when available).
- Action: AI Summary (Markdown download).

## Future extensions

- Include more event types: task created/updated, session summaries, alarms.
- Per-project filters and CSV export.
- Scheduled report generation and email delivery.
