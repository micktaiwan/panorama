# Roadmap ideas

## Core Features

- [ ] Compute project progress from tasks (aggregation logic)
- [ ] Risk and priority fields (simple enums) visible in list/detail.
- [ ] Auto-update project.status (derived rules)
  - blocked: if any blocking condition is detected (later, task flag)
  - active: default when activity is present (recent updatedAt)
  - planned: no activity (no tasks/notes/sessions) and no target date started
  - done: explicit user action or 100% tasks done + recent confirmation

## People

- [ ] Fetch team users from lemlist API (read-only import)

## Reporting

- [ ] daily recap job (cron) to compute and persist recaps (no notifications for now)

## Technical Checklist

- [ ] Respect error-handling rule: avoid try/catch unless necessary; never
      silent-catch
- [ ] Keep secrets out of code
- [ ] Keep lines reasonably wrapped and headings spaced in docs
