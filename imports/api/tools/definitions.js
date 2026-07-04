// Tool definitions in OpenAI function calling format
// Used by both Chat (Claude SDK) and MCP server
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'tool_listTools',
    description: 'List all available tools with their descriptions and parameters. Use when the user asks about available tools, capabilities, or what the assistant can do.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'tool_tasksByProject',
    description: 'Return non-completed tasks for a specific project. Use when the user mentions a project or asks for tasks within a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_tasksFilter',
    description: 'List and filter tasks by any combination of: deadline, status, project, tags, urgency, importance. Examples: {} (all tasks), {dueBefore:"2025-01-30"} (due before date), {important:true} (important only), {urgent:true,projectId:"abc"} (urgent in project), {status:"done"} (completed), {tag:"home"} (tagged home), {dueBefore:"2025-01-27",urgent:true} (due soon and urgent). Leave empty for no filtering.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dueBefore: { type: 'string', description: 'ISO date/time upper bound for deadline - returns tasks with deadline <= this date' },
        status: { type: 'string', description: 'Task status to filter (e.g., todo, doing, done)' },
        tag: { type: 'string', description: 'Tag value to filter' },
        projectId: { type: 'string', description: 'Optional project id to scope the filter' },
        important: { type: 'boolean', description: 'Filter by importance flag (true for important tasks only)' },
        urgent: { type: 'boolean', description: 'Filter by urgency flag (true for urgent tasks only)' }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_projectsList',
    description: 'List projects (name, description). Use for project discovery or selection.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'tool_projectByName',
    description: 'Fetch projects by name (case-insensitive, partial match). Returns a list of all matching projects. Use when the user names a project or searches for projects.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Project name or search term (case-insensitive partial match)' }
      },
      required: ['name']
    }
  },
  {
    type: 'function',
    name: 'tool_createProject',
    description: 'Create a new project with a name and optional description.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Project name (required)' },
        description: { type: 'string', description: 'Project description (optional)' },
        status: { type: 'string', description: 'Project status (optional, e.g., active, archived)' }
      },
      required: ['name']
    }
  },
  {
    type: 'function',
    name: 'tool_updateProject',
    description: 'Update a project\'s name, description, or status. Supports partial updates - only pass the fields you want to change. At least one field must be provided.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project ID (required)' },
        name: { type: 'string', description: 'New project name (optional)' },
        description: { type: 'string', description: 'New project description (optional)' },
        status: { type: 'string', description: 'New project status (optional, e.g., active, archived)' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_semanticSearch',
    description: 'Semantic search over workspace items (projects, tasks, notes, links). Returns top matches with titles and optional URLs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'User query for semantic retrieval' },
        limit: { type: 'number', description: 'Max results (default 8)' }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'tool_notesByProject',
    description: 'Return notes for a specific project. Use when the user asks about notes or documentation within a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project id' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_noteById',
    description: 'Fetch a single note by ID with full content (title, content, projectId, createdAt, updatedAt). Use when you need to read the content of a specific note and assess its freshness.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        noteId: { type: 'string', description: 'Note ID' }
      },
      required: ['noteId']
    }
  },
  {
    type: 'function',
    name: 'tool_notesByTitleOrContent',
    description: 'Search notes by keyword in title or content (case-insensitive, exact text match without semantic search). Returns notes with contextual snippets around the keyword. Use when you need to find notes containing specific keywords.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or search term to find in note titles or content'
        }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'tool_noteSessionsByProject',
    description: 'Return note sessions for a specific project. Use when the user asks about note sessions or meeting notes within a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project id' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_noteLinesBySession',
    description: 'Return note lines for a specific note session. Use when the user asks for details or content of a specific note session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'Note session id' }
      },
      required: ['sessionId']
    }
  },
  {
    type: 'function',
    name: 'tool_linksByProject',
    description: 'Return links for a specific project. Use when the user asks about bookmarks, URLs, or references within a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project id' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_peopleList',
    description: 'List people in the workspace. By default returns active employees with essential fields only. Use search parameter to find specific people.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        teamId: { type: 'string', description: 'Filter by team ID (optional)' },
        includeLeft: { type: 'boolean', description: 'Include people who left the company (default: false)' },
        includeContacts: { type: 'boolean', description: 'Include external contacts (default: false)' },
        includeDetails: { type: 'boolean', description: 'Return all fields instead of essential fields only (default: false). Essential fields: id, name, lastName, role, email, teamId' },
        search: { type: 'string', description: 'Search by name, lastName, or role (case-insensitive partial match)' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 50, max: 200)' },
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_createPerson',
    description: 'Create a new person. Use when the user wants to add someone (colleague, contact) to Panorama. Only "name" (first name) is required.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'First name (required)' },
        lastName: { type: 'string', description: 'Last name (optional)' },
        role: { type: 'string', description: 'Role / job title (optional)' },
        email: { type: 'string', description: 'Email address (optional)' },
        teamId: { type: 'string', description: 'Team ID (optional). Use tool_teamsList to find it' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative names/nicknames (optional)' },
        githubUsernames: { type: 'array', items: { type: 'string' }, description: 'GitHub login(s) for commit matching — a person can have several (optional)' },
        notes: { type: 'string', description: 'Free-text notes (optional)' },
        left: { type: 'boolean', description: 'Whether the person has left the company (optional, default false)' },
        contactOnly: { type: 'boolean', description: 'Whether the person is an external contact only (optional, default false)' }
      },
      required: ['name']
    }
  },
  {
    type: 'function',
    name: 'tool_updatePerson',
    description: 'Update a person\'s fields (role, name, lastName, email, teamId, etc.). All fields except personId are optional — only pass the fields you want to change.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        personId: { type: 'string', description: 'Person ID (required)' },
        name: { type: 'string', description: 'New first name (optional)' },
        lastName: { type: 'string', description: 'New last name (optional)' },
        role: { type: 'string', description: 'New role (optional)' },
        email: { type: 'string', description: 'New email address (optional)' },
        teamId: { type: 'string', description: 'New team ID, or empty string to unset (optional)' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative names/nicknames — replaces the whole list (optional)' },
        githubUsernames: { type: 'array', items: { type: 'string' }, description: 'GitHub login(s) — replaces the whole list. A person can have several handles (optional)' },
        notes: { type: 'string', description: 'Free-text notes — OVERWRITES the entire existing notes field. Use notesAppend to add to existing notes without losing them (optional)' },
        notesAppend: { type: 'string', description: 'Text to append to existing notes (separated by a newline) — preserves current notes. Use this instead of notes when adding information (optional)' },
        left: { type: 'boolean', description: 'Whether the person has left (optional)' },
        contactOnly: { type: 'boolean', description: 'Whether the person is an external contact only (optional)' }
      },
      required: ['personId']
    }
  },
  {
    type: 'function',
    name: 'tool_teamsList',
    description: 'List all teams in the workspace. Use when the user asks about teams, groups, or organizational structure.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'tool_filesByProject',
    description: 'Return files for a specific project. Use when the user asks about documents, attachments, or uploaded files within a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Project id' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_alarmsList',
    description: 'List alarms (reminders). Use when the user asks about alarms, reminders, or scheduled notifications. Optionally filter by enabled status.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', description: 'Filter by enabled status (optional)' }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_createAlarm',
    description: 'Create a new alarm/reminder. Use when the user wants to set a reminder or alarm for a specific time.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Title/description of the alarm' },
        nextTriggerAt: { type: 'string', description: 'ISO date string when alarm should trigger (e.g., "2025-10-31T08:00:00")' },
        enabled: { type: 'boolean', description: 'Whether alarm is enabled (default: true)' },
        recurrence: {
          type: 'object',
          description: 'Recurrence settings (optional)',
          properties: {
            type: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'], description: 'Recurrence type' },
            daysOfWeek: { type: 'array', items: { type: 'number' }, description: 'Days of week (0=Sunday, 6=Saturday) for weekly recurrence' }
          }
        }
      },
      required: ['title', 'nextTriggerAt']
    }
  },
  {
    type: 'function',
    name: 'tool_collectionQuery',
    description: 'Generic read-only query with sort/limit/select and a validated where DSL. The first choice for any list-style read: "recent notes", "recent tasks", "tasks since X", "people created last week", etc. — before reaching for a more specialized tool. userId scoping is applied automatically (no need to filter by user).\n\nSupported collections: tasks, projects, notes, noteSessions, noteLines, links, people, teams, files, alarms, userLogs, emails, mcpServers, notionIntegrations, notionTickets, claudeProjects, claudeSessions, claudeMessages.\n\nwhere DSL — operators: eq, ne, lt, lte, gt, gte, in, nin, and (array), or (array). Dates accept ISO 8601 strings (auto-converted) on fields: createdAt, updatedAt, deadline, when, snoozedUntilAt, arrivalDate. Unknown fields are silently dropped (allowlist per collection).\n\nExamples:\n• Recent notes across all projects: {collection:"notes", sort:{updatedAt:-1}, limit:20}\n• Notes updated since a date: {collection:"notes", where:{updatedAt:{gt:"2026-01-01T00:00:00Z"}}, sort:{updatedAt:-1}}\n• Recent tasks in a project: {collection:"tasks", where:{projectId:{eq:"abc"}}, sort:{updatedAt:-1}, limit:50}\n• Urgent open tasks: {collection:"tasks", where:{and:[{status:{ne:"done"}},{isUrgent:{eq:true}}]}}\n• People in a team: {collection:"people", where:{teamId:{eq:"xyz"}}, sort:{name:1}}\n\nPre-baked patterns are exposed in COMMON_QUERIES (helpers.js): recentNotes, recentSessions, costlySessions, tasksWithDeadline, urgentTasks, importantTasks, overdueTasks, todoTasks, inProgressTasks, activeTasks, activeSessions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        collection: { type: 'string', description: 'Collection name. Required. See list in tool description.' },
        where: { type: 'object', description: 'Filter DSL. Operators: eq, ne, lt, lte, gt, gte, in, nin, and (array), or (array). Empty/omitted = no filter (still userId-scoped). Example: {updatedAt:{gt:"2026-01-01T00:00:00Z"}}.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Fields to return. Unknown fields are dropped. Omit to return all allowed fields for the collection.' },
        limit: { type: 'number', description: 'Max docs (default 50, capped at 200).' },
        sort: { type: 'object', description: 'Mongo-style sort, e.g. {updatedAt:-1} or {deadline:1}. Use -1 for desc, 1 for asc.' }
      },
      required: ['collection']
    }
  },
  {
    type: 'function',
    name: 'tool_createTask',
    description: 'Create a new task. Optionally associate with a project, set status (todo/doing/done), add notes, deadline, and urgency/importance flags.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Task title (required)' },
        projectId: { type: 'string', description: 'Project ID to associate task with (optional)' },
        notes: { type: 'string', description: 'Task notes or description (optional)' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'Task status (default: todo)' },
        deadline: { type: 'string', description: 'Deadline as ISO date string (optional)' },
        isUrgent: { type: 'boolean', description: 'Mark as urgent (optional)' },
        isImportant: { type: 'boolean', description: 'Mark as important (optional)' }
      },
      required: ['title']
    }
  },
  {
    type: 'function',
    name: 'tool_updateTask',
    description: 'Update a task. Supports partial updates - only pass the fields you want to change (title, notes, status, deadline, project, urgency/importance). Use "done" status to mark as completed. All fields are optional except taskId.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Task ID (required)' },
        title: { type: 'string', description: 'New task title (optional)' },
        notes: { type: 'string', description: 'New task notes (optional)' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'New status - use "done" to mark as completed (optional)' },
        deadline: { type: 'string', description: 'New deadline as ISO date string (optional)' },
        projectId: { type: 'string', description: 'New project ID - use to move task to another project (optional)' },
        isUrgent: { type: 'boolean', description: 'Update urgency flag (optional)' },
        isImportant: { type: 'boolean', description: 'Update importance flag (optional)' }
      },
      required: ['taskId']
    }
  },
  {
    type: 'function',
    name: 'tool_deleteTask',
    description: 'Delete a task by ID. Use when the user wants to remove/delete a task permanently.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Task ID (required)' }
      },
      required: ['taskId']
    }
  },
  {
    type: 'function',
    name: 'tool_createNote',
    description: 'Create a new note with title and optional content. Associate with a project if needed. Content can be markdown formatted.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Note title (required)' },
        content: { type: 'string', description: 'Note content - supports markdown (optional)' },
        projectId: { type: 'string', description: 'Project ID to associate note with (optional)' }
      },
      required: ['title']
    }
  },
  {
    type: 'function',
    name: 'tool_updateNote',
    description: 'Update a note by REPLACING whole fields (uses $set per field). WARNING: there is NO append/patch — passing `content` OVERWRITES the entire note body, so anything you do not include is lost.\n\nMANDATORY: you MUST NOT call this with `content` unless you have just read the note with tool_noteById in the current conversation and are resending its full existing body verbatim plus your change. Never write `content` from memory, from an earlier/stale read, or from an assumption about what the note contains — always re-read immediately before overwriting, or you will silently destroy content you never saw.\n\nDO NOT use this to ADD to a large note. Many notes hold thousands of lines and embedded base64 images (pasted screenshots); making the model re-emit that whole body verbatim is error-prone (a single dropped character corrupts the note or an image) and expensive in tokens. To append or prepend a block, use tool_appendToNote instead — it edits the body server-side, so the existing content never has to pass back through the model.\n\nUse tool_updateNote for: renaming a note (title only), moving it to another project (projectId only), or a deliberate full-body replacement of a short note. "Partial" here is field-level only: you may set title alone without touching content, or vice-versa. All fields except noteId are optional; at least one must be provided.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        noteId: { type: 'string', description: 'Note ID (required)' },
        title: { type: 'string', description: 'New note title (optional)' },
        content: { type: 'string', description: 'New note body — supports markdown. REPLACES the entire existing body, NOT an append. Read current content via tool_noteById first and include it verbatim plus your changes. For adding a block to an existing note, prefer tool_appendToNote (optional)' },
        projectId: { type: 'string', description: 'New project ID (optional)' }
      },
      required: ['noteId']
    }
  },
  {
    type: 'function',
    name: 'tool_appendToNote',
    description: 'Add a block of text to an existing note WITHOUT resending its current body. The read-modify-write happens server-side: you send only the small `block`, and the existing content (however large — thousands of lines, embedded base64 images) never passes back through the model. This is the SAFE way to grow a note; prefer it over tool_updateNote whenever you are adding rather than fully rewriting.\n\nPlacement — three modes:\n• Default: append at the BOTTOM.\n• position:"top": prepend at the very start of the body.\n• afterMarker:"<text>": insert right after the line containing the first occurrence of <text>. Use this when the note has a fixed header the block must stay below — e.g. a note kept newest-first under an H1 title, where each meeting/day opens a new dated section BELOW the title but ABOVE the previous ones (pass the H1 as afterMarker). If afterMarker is given it wins over position; if the marker is not found the call errors (nothing is written) rather than guessing.\n\nIdempotency: pass `skipIfContains` with a marker unique to your block (e.g. a dated header "### 3 juillet") — if the note body already contains that string, nothing is written and the call returns skipped:true. This makes it safe to run the same prep repeatedly and to run it from several sessions.\n\nThe rest of the body is preserved verbatim (no reflow, no blank-line trimming); only your block plus one `separator` is inserted.\n\nConcurrency: the write respects the note lock. If the note is currently open/locked by another user (e.g. in the Panorama UI), the call fails with a note-locked error rather than clobbering their edit — retry once they are done.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        noteId: { type: 'string', description: 'Note ID (required)' },
        block: { type: 'string', description: 'The markdown text to insert (required). Keep it to the new content only — do NOT include the existing note body' },
        position: { type: 'string', enum: ['top', 'bottom'], description: 'Where to insert the block when afterMarker is not used: "bottom" (default) appends at the end, "top" prepends at the start (optional)' },
        afterMarker: { type: 'string', description: 'Insert the block immediately after the line containing the first occurrence of this string (e.g. the note H1 title), keeping it below that header. Overrides position. Errors if the string is absent from the body (optional)' },
        separator: { type: 'string', description: 'String inserted between the existing body and the block. Default "\\n\\n" (one blank line). Ignored when the note is currently empty (optional)' },
        skipIfContains: { type: 'string', description: 'Idempotency guard: if the existing note body already contains this exact substring, skip the write and return skipped:true. Use a unique marker from your block, e.g. its dated header (optional)' }
      },
      required: ['noteId', 'block']
    }
  },
  {
    type: 'function',
    name: 'tool_deleteNote',
    description: 'Delete a note by ID. Use when the user wants to remove/delete a note permanently.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        noteId: { type: 'string', description: 'Note ID (required)' }
      },
      required: ['noteId']
    }
  },
  {
    type: 'function',
    name: 'tool_createLink',
    description: 'Create a new web link/bookmark with a name and URL. Optionally associate with a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Link name/title (required)' },
        url: { type: 'string', description: 'Link URL (required). Will automatically add https:// if no scheme is provided.' },
        projectId: { type: 'string', description: 'Project ID to associate link with (optional)' }
      },
      required: ['name', 'url']
    }
  },
  {
    type: 'function',
    name: 'tool_userLogsFilter',
    description: 'List user logs with optional filter on recent days. Use when the user asks about their journal entries, logs, or activity history.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lastDays: {
          type: 'number',
          description: 'Get logs from the last N days (e.g., 7 for last week, 30 for last month). When specified, returns all logs from that period (up to 1000). Without this filter, returns the 50 most recent logs.'
        },
        limit: {
          type: 'number',
          description: 'Max number of logs to return (max: 1000). Overrides default behavior.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_emailsUpdateCache',
    description: 'Update the local email cache by fetching new messages from Gmail inbox. Retrieves the N most recent inbox messages, adds new ones to cache, and syncs labels for existing cached messages. Use when the user asks to refresh/sync/update their emails or check for new messages.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of inbox emails to fetch from Gmail API (default: 20, max: 500). To sync all inbox messages, use a high value like 500.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_emailsSearch',
    description: 'Search through cached emails using Gmail query syntax or semantic search. Use when the user wants to find emails by sender, subject, content, or date range.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (Gmail syntax like "from:sender@example.com subject:invoice" or natural language for semantic search)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 50)'
        },
        useSemanticSearch: {
          type: 'boolean',
          description: 'Use semantic/vector search instead of exact text matching (default: false)'
        }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'tool_projectsOverview',
    description: 'Get a complete panorama/overview/dashboard of ALL projects at once with their health, urgency, and stats. Use when the user asks for: "panorama", "overview", "dashboard", "status of all projects", "what projects need attention", "project health", "urgent projects", or wants to see the big picture across all projects. Returns comprehensive metrics: tasks (total/open/done/overdue), notes, links, files, health scores, and activity. Single call replaces multiple tool_projectsList + tool_tasksByProject calls.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        periodDays: {
          type: 'number',
          description: 'Period in days for activity and heat analysis (default: 14, min: 1, max: 365)'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_emailsRead',
    description: 'Read the full content of one or more emails by their ID. Use when the user wants to see the complete message body and details.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        emailIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of email IDs (MongoDB _id or Gmail message ID) to read'
        },
        includeThread: {
          type: 'boolean',
          description: 'Include all messages in the thread (default: false)'
        }
      },
      required: ['emailIds']
    }
  },
  {
    type: 'function',
    name: 'tool_emailsListLabels',
    description: 'List all Gmail labels available for the user. Use when the user wants to see available labels or when preparing to add/remove labels.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'tool_emailsAddLabel',
    description: 'Add a Gmail label to an email. Use when the user wants to categorize or tag an email.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        messageId: {
          type: 'string',
          description: 'Gmail message ID of the email to label'
        },
        labelId: {
          type: 'string',
          description: 'Gmail label ID to add (e.g., "STARRED", "IMPORTANT", or custom label IDs)'
        }
      },
      required: ['messageId', 'labelId']
    }
  },
  {
    type: 'function',
    name: 'tool_emailsRemoveLabel',
    description: 'Remove a Gmail label from an email. Use when the user wants to remove a category or tag from an email.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        messageId: {
          type: 'string',
          description: 'Gmail message ID of the email'
        },
        labelId: {
          type: 'string',
          description: 'Gmail label ID to remove (e.g., "STARRED", "IMPORTANT", or custom label IDs)'
        }
      },
      required: ['messageId', 'labelId']
    }
  },
  {
    type: 'function',
    name: 'tool_emailsCreateLabel',
    description: 'Create a new Gmail label. Use when the user wants to create a new category/tag for organizing emails. Returns the created label with its ID, or the existing label if it already exists.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        labelName: {
          type: 'string',
          description: 'Name of the label to create (e.g., "panorama", "Important Project", "Follow-up")'
        }
      },
      required: ['labelName']
    }
  },
  {
    type: 'function',
    name: 'tool_emailsCleanCache',
    description: 'Clean the local email cache by removing old or archived emails while preserving important ones. Use when the user wants to reduce cache size or clean up old emails. Safe operation that only affects local cache, not Gmail.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keepInbox: {
          type: 'boolean',
          description: 'Keep emails with INBOX label (default: true)'
        },
        keepRecent: {
          type: 'boolean',
          description: 'Keep recent emails based on daysToKeep parameter (default: true)'
        },
        daysToKeep: {
          type: 'number',
          description: 'Number of days to keep if keepRecent is true (default: 30, min: 1, max: 365)'
        },
        keepStarred: {
          type: 'boolean',
          description: 'Keep emails with STARRED label (default: true)'
        },
        keepImportant: {
          type: 'boolean',
          description: 'Keep emails with IMPORTANT label (default: true)'
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only simulates cleanup and returns what would be deleted without actually deleting (default: false)'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_mcpServersSync',
    description: 'Sync MCP server configurations from Claude Desktop config. Reads claude_desktop_config.json and imports server configurations into Panorama. Use when the user wants to import their existing MCP servers from Claude Desktop.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    type: 'function',
    name: 'tool_claudeProjectsList',
    description: 'List all Claude Code projects (sorted by updatedAt desc). Use when the user asks about Claude Code projects, workspaces, or coding sessions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'tool_claudeSessionsByProject',
    description: 'Return Claude Code sessions for a specific Claude project. Use when the user asks about sessions or coding activity within a Claude project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Claude project ID' }
      },
      required: ['projectId']
    }
  },
  {
    type: 'function',
    name: 'tool_claudeSessionStats',
    description: 'Get detailed statistics for a Claude Code session: message counts by role/type, cost, duration. Use when the user asks about session details or metrics.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'Claude session ID' }
      },
      required: ['sessionId']
    }
  },
  {
    type: 'function',
    name: 'tool_claudeMessagesBySession',
    description: 'Return messages for a Claude Code session (sorted chronologically). Use when the user wants to see the conversation history of a session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'Claude session ID' },
        limit: { type: 'number', description: 'Max messages to return (default 50, max 200)' }
      },
      required: ['sessionId']
    }
  },
  {
    type: 'function',
    name: 'tool_claudeMessagesSearch',
    description: 'Search Claude Code messages by text content (case-insensitive regex). Use when the user wants to find specific messages across sessions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Text to search in message content' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 200)' }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'tool_readFile',
    description: 'Read the contents of a file from the local filesystem. Supports text files (markdown, JSON, JavaScript, etc.). Use when the user wants to read or examine file contents.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute file path to read (e.g., /Users/name/.claude/plans/filename.md). Path must be absolute, not relative.'
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'utf16le', 'latin1', 'ascii'],
          description: 'Text encoding for reading the file (default: utf8)'
        }
      },
      required: ['filePath']
    }
  },
  {
    type: 'function',
    name: 'tool_claudeSessionsList',
    description: 'List all Claude Code sessions across all projects. Use when the user asks about Claude sessions, running processes, or wants an overview of Claude activity.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'number',
          description: 'Max sessions to return (default 50, max 200)'
        },
        status: {
          type: 'string',
          description: 'Filter by status: idle, running, error, interrupted'
        },
        sortBy: {
          type: 'string',
          description: 'Sort field: updatedAt (default), createdAt, totalCostUsd'
        },
        sortOrder: {
          type: 'string',
          description: 'Sort direction: asc, desc (default)'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'tool_createRelease',
    description: 'Create a new release note (global announcement visible to all users). Use when publishing release notes for a new version.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'string', description: 'Version string (e.g., "1.2.3")' },
        title: { type: 'string', description: 'Short title for the release' },
        content: { type: 'string', description: 'Release notes content in markdown format' }
      },
      required: ['version', 'title', 'content']
    }
  },
];
