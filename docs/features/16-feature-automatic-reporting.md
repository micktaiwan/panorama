# Feature: Automatic Reporting (Activity Feed + AI Summary)

## Goal

Provide a dedicated reporting view that lists recent activity across the workspace and can be summarized by AI to produce a concise status report for leadership.

## Scope (MVP)

- Time window selector: 24h, 72h, last 7 days, 3 weeks, or all time.
- Activity types shown: projects created, tasks completed, notes added.
- Sorted newest first and grouped by category for quick scanning.
- One-click AI summary that produces a concise report in the selected language and format.

## UI

- A Reporting page with:
  - A toolbar to choose the time window, refresh, and view the selected period.
  - A content area that groups events by type with timestamps and titles (shows project context when available).
  - Actions to generate an AI summary with selectable language (FR/EN) and output format (Text/Markdown), plus easy copy to clipboard.

## Future extensions

- Include more event types: task created/updated, session summaries, alarms.
- Per-project filters and CSV export.
- Scheduled report generation and email delivery.
