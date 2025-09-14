# Text to Tasks (Global Import)

Related docs:

- [Context](./00-context.md)
- [Technical notes](./02-tech-notes.md)

## Overview

Provide a global page where the user can paste free text and get structured
suggestions for projects to create and tasks to add. The system extracts as
much information as possible from the text (titles, deadlines, notes), maps
each task to an existing project when possible, or proposes a new project
otherwise. Nothing is saved until the user clicks an explicit save action per
line.

## Scope and positioning

- **Route**: dedicated page `#/import-tasks` accessible from the header.
- **Global feature**: not tied to a specific project.
- **Persistence**: results are not stored in the database until the user
  chooses to save each suggested item.

## User flow

1. Navigate to `Import tasks` (`#/import-tasks`).
2. Paste arbitrary text into a textarea.
3. Click "Analyze" to run the LLM extraction.
4. See two sections of suggestions:
   - **Projects to create**: proposed new project names with optional
     descriptions and a "Create" button per line.
   - **Tasks to add**: each row shows an editable title, notes hint (if any),
     a deadline picker, and a suggested project. The project can be changed via
     a select. Per-line actions: remove suggestion, clear deadline, save task.
5. Saving a task uses the currently selected project. If the project row was
   created during this session, it becomes selectable for tasks as well.
6. Failures show an inline error. No automatic retries.

## Extraction and mapping

- **LLM**: use OpenAI (same provider as the existing AI features).
- **Input**: pasted text plus the list of existing projects (name and a short
  description if available). The model must map tasks to an existing project
  when a close match is found, or suggest a new project name otherwise.
- **Output**: strict JSON conforming to a predefined schema (see below).
- **Dates**: extract relative deadlines (e.g., "tomorrow") and return ISO
  dates (`YYYY-MM-DD`). If ambiguous, omit `deadline`.
- **Task titles**: normalize to clear, concise action titles.

## JSON output schema (for LLM)

The model must return a single JSON object that matches this shape. We will
use OpenAI JSON mode to enforce structure on the server.

```json
{
  "projects": [
    {
      "name": "string",
      "description": "string optional",
      "status": "planned|active|blocked|done optional"
    }
  ],
  "tasks": [
    {
      "sourceLine": "string optional",
      "title": "string",
      "notes": "string optional",
      "deadline": "YYYY-MM-DD optional",
      "projectSuggestion": {
        "matchType": "existing|new|unknown",
        "name": "string", 
        "confidence": 0.0
      }
    }
  ]
}
```

Notes:

- **projects**: only include when a new project seems warranted.
- **projectSuggestion**:
  - `existing` → `name` must match one of the provided project names.
  - `new` → `name` is the suggested new project to create.
  - `unknown` → leave mapping to the user.

## Database alignment

Current model (from `00-context.md` and `imports/api/*`):

- **Project**: `name`, `description`, `status`, `startDate`, `targetDate`,
  `progressPercent`, `riskLevel`, `links`, `createdAt`, `updatedAt`.
- **Task**: `projectId`, `title`, `status`, `dueDate`, `estimate`, `actual`,
  `progressPercent`, `notes`, `createdAt`, `updatedAt`. Task completion is tracked with `status='done'` and `statusChangedAt`.
  existing methods.

For this feature we will populate: `Project.name`, `Project.description`
optional, `Project.status` default `planned`; and `Task.title`, `Task.notes`
optional, `Task.deadline` optional.

## API design (server)

- **Method**: `ai.textToTasksAnalyze(inputText)`
  - Loads existing projects (`name`, `description` when available).
  - Builds a constrained prompt with the schema and the provided project list.
  - Calls OpenAI Chat Completions with JSON mode and low temperature.
  - Returns the parsed JSON object as-is to the client.

- **Save operations** (existing methods are reused):
  - Create project: `projects.insert({ name, description?, status: 'planned' })`.
  - Create task: `tasks.insert({ projectId, title, notes?, deadline? })`.

## Prompt strategy (high level)

- System: "You convert free-form text into structured projects and tasks.
  Output JSON only."
- Instructions:
  - Receive a list of existing projects.
  - Propose new projects only when necessary.
  - Map each task to the best existing project name when confidence is high.
  - Extract clear titles and optionally notes and deadlines.
  - Return a single JSON object that validates against the provided schema.

## UI design (client)

- **Route**: add `import-tasks` to the hash router.
- **Component**: `imports/ui/ImportTasks/ImportTasks.jsx` with stylesheet.
- **Layout** using shared `Card`:
  - Top card: textarea, "Analyze" button, error banner.
  - Projects card: list of proposed new projects with a per-line "Create"
    button.
  - Tasks card: table/list with columns: Project | Deadline | Task | Actions.
    - Task: inline editable title (per `InlineEditable`).
    - Actions: remove suggestion, clear deadline, save task.

## Error handling

- Show an inline error banner when the analyze call fails.
- No retry for now. User can edit the text and analyze again.

## Example

Input (excerpt):

```
tasks for the weekend
  boring
    crédit agricole: sign the papers, reply to banker email
    find USB-C <=> USB adapter for the Mac to print
  CR Charles / Corentin
  read Charles Claap doc (disagree but commit)
  re-read CIR
  LK issue (Julien)
  BasicMemory and https://lobehub.com/mcp/...
  continue convo with Bastien about AI
  Claap POC
  vibe code real time voice
  vibe code project manager
```

Possible output (abridged):

```json
{
  "projects": [
    { "name": "Personal", "description": "Personal admin and chores" }
  ],
  "tasks": [
    {
      "sourceLine": "crédit agricole: sign the papers, reply to banker email",
      "title": "Sign bank papers and reply to adviser",
      "notes": "Crédit Agricole: sign papers, reply to email",
      "dueDate": "2025-08-31",
      "status": "planned",
      "projectSuggestion": { "matchType": "existing", "name": "Personal", "confidence": 0.86 }
    }
  ]
}
```

## Implementation TODOs

- [x] Add route `import-tasks` in `imports/ui/router.js` and navigation link
- [x] Create `ImportTasks` component (textarea, analyze, results UI)
- [x] Show loading state on Analyze and disable while running
- [x] Filter suggested projects that already exist (case-insensitive)
- [x] Preselect existing project suggestions; preselect inline Create "X" for `new`
- [x] Restructure task rows into columns: Project | Deadline | Task | Actions
- [x] Allow editing the task title inline before save
- [x] Add deadline picker, clear-deadline action, and tooltips
- [x] Add delete-suggestion action (remove row from import)
- [x] Switch to `deadline` (drop task status entirely)
- [x] Sanitize project descriptions (one line) in prompt
- [x] Add server logs: raw model content + parsed summary
- [x] Server post-process: keep only new in `projects[]`, convert non-matching to `new`, ban `Unknown`/buckets
- [x] Add current date/time to prompt; require explicit temporal cues for deadlines
- [ ] Drop past deadlines server-side (omit if < today)
- [ ] Basic tests for prompt building and response parsing
- [ ] E2E: save with inline-created project and deadline conversion
- [ ] Optional: make notes editable before save
- [ ] Optional: hide very generic projects from prompt (e.g., `General`, `Sandbox`)
