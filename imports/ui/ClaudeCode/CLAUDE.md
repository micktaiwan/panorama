# ClaudeCode UI Module

## Known Gotchas

### Tilde (`~`) in paths

The `cwd` field in Claude projects can contain `~` (e.g., `~/projects/foo`), but file paths from Electron dialogs are always absolute (e.g., `/Users/mickaelfm/projects/foo/bar.js`).

**Always expand `~` before comparing paths:**

```javascript
let cwd = activeProject?.cwd;
if (cwd && homeDir && cwd.startsWith('~')) {
  cwd = cwd.replace(/^~/, homeDir);
}
```

`homeDir` is available via the `useHomeDir()` hook.

**Affected areas:**
- Sidebar file validation (files must be within project cwd)
- File restoration from localStorage
- Any path comparison involving project cwd
