// Tool definitions in OpenAI function calling format
// Used by both Chat and MCP server

// Pure helpers for building citations used by chat methods.
export const buildCitationsFromMemory = (memory) => {
  const list = memory?.lists?.searchResults;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.map((r) => ({ id: r.id, title: r.title, kind: r.kind, url: r.url || null }));
};

export const buildCitationsFromToolResults = (toolCalls, toolResults) => {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const results = Array.isArray(toolResults) ? toolResults : [];
  const citations = [];
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    if (call && call.name === 'tool_semanticSearch') {
      const match = results.find((r) => r?.tool_call_id === (call.id || 'tool_semanticSearch'));
      if (match && match.output) {
        try {
          const parsed = JSON.parse(match.output);
          const items = Array.isArray(parsed?.results) ? parsed.results : [];
          for (let j = 0; j < items.length; j += 1) {
            const it = items[j];
            citations.push({ id: it.id, title: it.title, kind: it.kind, url: it.url || null });
          }
        } catch (err) {
          console.error('[tools/definitions] parse tool result failed', err);
        }
      }
    }
  }
  return citations;
};

// Exported tool definitions for Chat and MCP
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
    description: 'Fetch a single project by its name (case-insensitive). Use when the user names a project.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Project name (case-insensitive match)' }
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
    description: 'Update a project\'s name, description, or status. At least one field must be provided.',
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
    description: 'List all people in the workspace. Use when the user asks about contacts, people, or team members.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
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
    description: 'Generic read-only query across collections with a validated where DSL. Use to filter items by fields.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        collection: { type: 'string' },
        where: { type: 'object' },
        select: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
        sort: { type: 'object' }
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
    description: 'Update a task. Change title, notes, status (use "done" to mark as completed), deadline, project association, or urgency/importance flags. All fields are optional except taskId.',
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
    description: 'Update a note\'s title, content, or project association. All fields except noteId are optional.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        noteId: { type: 'string', description: 'Note ID (required)' },
        title: { type: 'string', description: 'New note title (optional)' },
        content: { type: 'string', description: 'New note content - supports markdown (optional)' },
        projectId: { type: 'string', description: 'New project ID (optional)' }
      },
      required: ['noteId']
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
    description: 'Update the local email cache by fetching new messages from Gmail. Use when the user asks to refresh/sync/update their emails or check for new messages.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of emails to fetch from Gmail API (default: 20, max: 100)'
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
    name: 'tool_mcpServersSync',
    description: 'Sync MCP server configurations from Claude Desktop config. Reads claude_desktop_config.json and imports server configurations into Panorama. Use when the user wants to import their existing MCP servers from Claude Desktop.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
];

export const buildPlannerConfig = (system, user, toolNames) => {
  const plannerSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      steps: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: { type: 'string', enum: toolNames },
            args: {
              type: 'object',
              additionalProperties: false,
              properties: {
                dueBefore: { type: 'string' },
                projectId: { type: 'string' },
                status: { type: 'string' },
                now: { type: 'string' },
                tag: { type: 'string' },
                name: { type: 'string' },
                sessionId: { type: 'string' },
                enabled: { type: 'boolean' },
                query: { type: 'string' },
                limit: { type: 'number' },
                collection: { type: 'string' },
                where: { type: 'object' },
                select: { type: 'array', items: { type: 'string' } },
                important: { type: 'boolean' },
                urgent: { type: 'boolean' }
              }
            }
          },
          required: ['tool', 'args']
        }
      },
      stopWhen: {
        type: 'object',
        additionalProperties: false,
        properties: {
          have: { type: 'array', maxItems: 5, items: { type: 'string' } }
        }
      }
    },
    required: ['steps']
  };

  const plannerPrompt = [
    'You will plan the minimal sequence of tool calls to answer the user.',
    'Choose only from the allowed tools and provide precise arguments.',
    '',
    '=== Tool Selection Guidelines ===',
    'For "latest/recent important subjects/topics/items":',
    '  - Use tool_overdue for overdue tasks',
    '  - OR tool_tasksFilter with isImportant/isUrgent filters',
    '  - DO NOT use semantic search for this - use structured task queries',
    '',
    'For "tasks in project X":',
    '  - First: tool_projectByName(name="X")',
    '  - Then: tool_tasksByProject (projectId will be auto-bound)',
    '',
    'For "find/search for content about X":',
    '  - Use tool_semanticSearch(query="X") for semantic content search',
    '  - Best for: finding notes, documents, or content by keywords',
    '',
    'For status/tag filters:',
    '  - Use tool_tasksFilter(status="todo/doing/done", tag="...")',
    '',
    '=== Planning Strategy ===',
    'Plan 2-3 tools when possible for robustness (e.g., try tool_overdue AND tool_tasksFilter).',
    'Use tool_semanticSearch as a fallback, not as primary for structured queries.',
    '',
    '=== Technical Details ===',
    'IMPORTANT: Include stopWhen.have to avoid unnecessary steps.',
    'Examples: ["lists.tasks"] after getting tasks, ["ids.projectId"] after finding project, ["lists.*"] when any list is populated.',
    'Leverage variable binding: use {"var":"ids.projectId"} to reference previously found IDs.',
    'CRITICAL: Respond with ONLY valid JSON that matches the schema. No prose, no markdown. Keep at most 5 steps.'
  ].join(' ');

  const plannerMessages = [
    { role: 'system', content: `${system} Allowed tools: ${toolNames.join(', ')}. ${plannerPrompt}` },
    { role: 'user', content: user }
  ];

  return { plannerSchema, plannerPrompt, plannerMessages };
};

export const buildResponsesFirstPayload = (system, user) => {
  return {
    model: 'o4-mini',
    instructions: system,
    input: [ { role: 'user', content: [ { type: 'input_text', text: user } ] } ],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto'
  };
};

export const extractResponsesToolCalls = (data) => {
  const outputArray = Array.isArray(data?.output) ? data.output : [];
  const toolCallsFromOutput = outputArray
    .filter((it) => it && (it.type === 'tool_call' || it.type === 'function_call'))
    .map((tc) => {
      const argsStr = (typeof tc?.arguments === 'string') ? tc.arguments : (tc?.function?.arguments || '');
      let argsObj = {};
      try { if (argsStr) argsObj = JSON.parse(argsStr); } catch { argsObj = {}; }
      return {
        id: tc?.id || tc?.tool_call_id || tc?.call_id || '',
        name: tc?.name || tc?.tool_name || tc?.function?.name || '',
        arguments: argsObj
      };
    });
  const toolCallsTop = Array.isArray(data?.tool_calls) ? data.tool_calls.map((tc) => ({
    id: tc?.id || tc?.tool_call_id || '',
    name: tc?.function?.name || tc?.name || '',
    arguments: (() => { try { return typeof tc?.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc?.arguments || {}); } catch { return {}; } })()
  })) : [];
  const toolCallsAll = (toolCallsFromOutput.length > 0 ? toolCallsFromOutput : toolCallsTop);
  return toolCallsAll.slice(0, 5);
};
