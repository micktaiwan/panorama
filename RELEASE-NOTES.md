## 2026-02-11

### Fix: Claude Code "Loading sessions..." stuck indefinitely
- Used `useSubscribe` return value to detect subscription readiness in `ClaudeCodePage.jsx`
- Shows "No sessions yet." + "New Session" button when subscriptions are ready but no sessions exist

### Feature: Confirmation modal for Claude project deletion
- Added Modal confirmation before deleting a Claude project in `ProjectList.jsx`
- Prevents accidental project deletion

### Feature: Shift+click bypasses delete confirmation globally
- Shift+click on any delete button skips the confirmation modal and deletes immediately
- Applied to: Claude projects, Claude notes, Notes tabs, Notion integrations

### Feature: `/bypass` command
- New slash command that sets permissions to `Bash(*)`, `Edit`, `Write` for unrestricted access
