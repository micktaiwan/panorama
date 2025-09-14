# Feature: In‑app Alarms

## Need

- Allow the user to create one or multiple alarms that trigger at a specific date and time.
- At the scheduled time, show an in‑app popup (Modal) with actionable controls and optionally play a sound.
- Support recurring alarms (e.g., daily or weekly) in addition to one‑off alarms.
- Provide snooze shortcuts (e.g., +5m, +10m, +15m) and a dismiss action.
- Persist alarms in the database; alarms remain across sessions and across page reloads.
- The feature is in‑app: it only triggers when the Panorama tab is open and active (no native/system notifications in MVP).

Non‑goals (MVP):

- Push/system notifications when the app/tab is closed.
- Complex recurrence rules beyond simple daily/weekly/monthly presets.

Constraints/notes:

- Browser timers can be throttled in background tabs; provide a minute‑based fallback tick and handle `visibilitychange` to catch up missed alarms.
- Avoid duplicate triggers across multiple open tabs by coordinating leadership (single scheduler) per browser profile.

## Proposed Data Model (Alarm)

- _id: string (Mongo ID)
- title: string (short label shown in popup and list)
- enabled: boolean
- nextTriggerAt: Date (the next occurrence to fire; for one‑off alarms this is the target time)
- recurrence: { type: 'none' | 'daily' | 'weekly' | 'monthly', daysOfWeek?: number[] }
- snoozedUntilAt?: Date (if snoozed, overrides nextTriggerAt until that time)
- done: boolean (true when fired and acknowledged or auto-processed in MVP)
- lastFiredAt?: Date (set when an alarm fires)
- acknowledgedAt?: Date (set when user snoozes/dismisses)
- userId?: string (unused in MVP; no accounts)
- createdAt: Date
- updatedAt: Date

Notes:

- On fire: in MVP, mark disabled and set `done=true` with `lastFiredAt`. Later, if recurrence is set, compute the next occurrence and update `nextTriggerAt`.
- If snoozedUntilAt is set, use that as the effective next check, then clear it after firing.
- Use `acknowledgedAt` to avoid repeated prompts after the user has acted (snooze/dismiss).

## UX

- List of alarms: title, next trigger (formatted + timeAgo), recurrence badge, enabled toggle, actions (edit, delete).
- Create/edit alarm: title (required), date, time, recurrence selector.
- When an alarm fires: open a Modal with title and actions: Snooze (+5, +10, +15), Dismiss. Optionally play a sound (see Roadmap: optional/late).

## Roadmap (with checkboxes)

Refer to @02-tech-notes.md for technical notes.
Consistently follow the established practices (use components, avoid inline styles, maintain folder organization).

MVP

- [x] Create `AlarmsCollection` with publications and Meteor methods (insert/update/remove/toggle/snooze/dismiss)
- [x] UI: Alarms list with create and delete (edit inline later)
- [x] Client scheduler: schedule nearest alarm with `Meteor.setTimeout`; add 1‑minute fallback interval and handle `visibilitychange`
- [x] Trigger popup on fire with actions: Snooze (+5/+10/+15), Dismiss (Modal component to be used later)
- [x] Persist snooze by setting `snoozedUntilAt` and rescheduling
- [x] Single‑tab leadership via `localStorage` heartbeat (BroadcastChannel later)
- [x] Add route `#/alarms` and footer navigation entry
- [x] Alarms page scaffold: list and create form
- [x] Publication: all alarms (MVP, no accounts)
- [x] Methods: `alarms.insert`, `alarms.update`, `alarms.remove`, `alarms.toggleEnabled`, `alarms.snooze`, `alarms.dismiss`
- [x] Enable/disable toggle in list
- [x] Catch‑up firing on startup and `visibilitychange`
- [x] Leader election via `localStorage` heartbeat (BroadcastChannel later)
- [x] Help page update with alarm actions and keyboard hints
- [ ] Unit tests for `computeNextOccurrence` and scheduler catch‑up logic

Recurrence (Phase 2)

- [ ] Add recurrence presets: none, daily, weekly (choose days), monthly (by date)
- [ ] Implement `computeNextOccurrence` and update `nextTriggerAt` after each fire
- [ ] Display recurrence badges and next computed date in UI
- [ ] Weekly UI: select days of week; compute next from today/time
- [ ] Monthly UI: pick day-of-month; roll forward if past in current month
- [ ] Editing recurrence recomputes `nextTriggerAt` safely (no past dates)
- [ ] Gracefully handle DST transitions at local time

Polish (Phase 3)

- [ ] Improve reliability in background with catch‑up check on resume (app/tab becomes visible)
- [ ] Add per‑alarm color/emoji for quick visual scan
- [ ] Prevent concurrent triggers by confirming leadership before firing (see Tech Notes)
- [ ] Custom snooze input (minutes) in addition to quick buttons
- [ ] Sorting (by next trigger) and filtering (enabled/recurring)
- [ ] Better empty state with CTA to create first alarm
- [x] Localized datetime display and `timeAgo`
- [x] Keyboard shortcuts in Modal (1,2,3 for snoozes; Esc for dismiss)
- [ ] Idempotent fire guard to prevent double firing across tabs
