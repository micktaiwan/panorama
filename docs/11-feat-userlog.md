# UserLog (Board Journal) Feature

## Summary

The team discussed building a specialized “board journal” feature to log interruptions and resume tasks throughout the day. It will be a dedicated overlay module, simpler than full note sessions, with manual timestamping and metadata entry. Initially there will be no task linking or multi-line input, manual autosave via Enter, and a keyboard shortcut to open the quick note. Tags will be simple text codes at note start, with plans for an auto-tag parser and collapsible display options in later iterations.

## Decisions

- Use a dedicated module rather than extending note sessions [L15]
- No multi-line input for journal entries [L16]
- Do not link entries to tasks initially [L10]
- Autosave manually upon pressing Enter [L13]
- Timestamp every entry [L8]
- Use simple text-based tags at the start of each note [L14]
- Provide an overlay interface (like AI Chat feature) for quick journaling [L5]
- Implement a keyboard shortcut to open the quick note and focus on a new entry line[L12]

## Implemented MVP (2025-09)

- Overlay module `UserLog` (toggle with ⌘J / Ctrl+J). ESC closes the summary first (if open), then the journal.
- Input is placed at the top; Enter saves a one‑line entry; entries are sorted DESC.
- Each entry shows HH:MM:SS at the start and a relative "time ago" at the end.
- Hour sections render between groups; headers display the next hour bucket for smoother DESC reading.
- Keyboard: ⌘J toggles; ESC inside input cancels editing only (does not close overlay).
- Visuals: stronger borders/glow for popups; task list and summary panels have max‑height with inner scroll.

### Spell‑check / cleanup per entry
- A small wand icon per line triggers an LLM spelling/grammar correction; UI shows progress and success/error toasts.

### Summarize the day/window
- Toolbar offers timeframes: Last 1h, 3h (default), 24h, 7 days.
- Shows cutoff preview and number of included lines (computed locally).
- Calls `userLogs.summarizeWindow` which:
  - Filters entries server‑side by window, sends projects catalog and local ISO timestamps with timezone.
  - Logs prompts and raw model output on the server for traceability.
  - Returns a JSON object with `summary` and `tasks[]` (each task may include `sourceLogIds` of journal entries).
- UI displays a second‑level modal with:
  - Summary text and Copy button.
  - Task suggestions: editable project (select) and deadline (inline date), Create buttons, and a Create‑all action.
  - Reopen summary button restores the last generated payload from localStorage.

### Provenance linking and duplicate protection
- When creating a task from a suggestion that includes `sourceLogIds`, the task stores:
  - `source = { kind: 'userLog', logEntryIds: [...], windowHours }`.
- Before insert, the server rejects duplicates when any `logEntryIds` is already referenced by another task.
- In the summary modal, suggestions are dimmed and disabled only if a real DB task exists with overlapping `logEntryIds`.
- In the journal list, a green link icon 🔗 appears next to the timestamp when a task exists for that line; clicking it closes the journal and navigates to the project.

### Timezone accuracy
- The server provides Now/Since in local ISO with offset and an explicit IANA timezone to anchor the model.
- The prompt instructs using only the provided local timestamps. The UI renders the window header itself and does not rely on model phrasing for the period.

## Clarifications

- No route necessary: we have a panel always visible (or callable by a shortcut)
- No relation with session notes, but we can consider reusing a common component to display a journal (in tilde/overlay) or a session note (on the dedicated page)
- Retention: we keep everything

## Next steps

- Tagging and auto‑tag parser (future): design simple prefix tags and optional auto‑detection.
- Optional: deep‑link to a specific task from the linked icon (with row highlight).
- Optional: per‑entry tags/labels and filtering in the overlay.
- Optional: export/import of UserLog with provenance for offline review.
