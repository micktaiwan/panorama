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
    if (call && call.name === 'chat_semanticSearch') {
      const match = results.find((r) => r && r.tool_call_id === (call.id || 'chat_semanticSearch'));
      if (match && match.output) {
        try {
          const parsed = JSON.parse(match.output);
          const items = Array.isArray(parsed?.results) ? parsed.results : [];
          for (let j = 0; j < items.length; j += 1) {
            const it = items[j];
            citations.push({ id: it.id, title: it.title, kind: it.kind, url: it.url || null });
          }
        } catch (err) {
          console.error('[tools_helpers] parse tool result failed', err);
        }
      }
    }
  }
  return citations;
};

// Exported tool definitions for Responses API
export const CHAT_TOOLS_DEFINITION = [
  {
    type: 'function',
    name: 'chat_tasks',
    description: 'List non-completed tasks filtered by deadline upper bound and/or project. Use for queries like tasks due before a date (e.g., tomorrow). Exclude completed tasks by default.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dueBefore: { type: 'string', description: 'ISO date/time upper bound for deadline (server normalizes to local tomorrow 23:59:59 if omitted)' },
        projectId: { type: 'string', description: 'Filter by project id' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'] }
      }
    }
  },
  {
    type: 'function',
    name: 'chat_overdue',
    description: 'Return non-completed tasks with deadline <= now. Use when the user asks for overdue or late items. Defaults to current time if now is not provided.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        now: { type: 'string', description: 'ISO date/time (optional). Defaults to current time.' }
      }
    }
  },
  {
    type: 'function',
    name: 'chat_tasksByProject',
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
    name: 'chat_tasksFilter',
    description: 'Return tasks filtered by simple attributes like status, tag, and/or projectId. Use when the user specifies a tag or status filter.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', description: 'Task status to filter (e.g., todo, doing, done)' },
        tag: { type: 'string', description: 'Tag value to filter' },
        projectId: { type: 'string', description: 'Optional project id to scope the filter' }
      }
    }
  },
  {
    type: 'function',
    name: 'chat_projectsList',
    description: 'List projects (name, description). Use for project discovery or selection.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'chat_projectByName',
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
    name: 'chat_semanticSearch',
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
  { type: 'function', name: 'chat_notesByProject', parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' } }, required: ['projectId'] } },
  { type: 'function', name: 'chat_noteSessionsByProject', parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' } }, required: ['projectId'] } },
  { type: 'function', name: 'chat_noteLinesBySession', parameters: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
  { type: 'function', name: 'chat_linksByProject', parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' } }, required: ['projectId'] } },
  { type: 'function', name: 'chat_peopleList', parameters: { type: 'object', additionalProperties: false, properties: {} } },
  { type: 'function', name: 'chat_teamsList', parameters: { type: 'object', additionalProperties: false, properties: {} } },
  { type: 'function', name: 'chat_filesByProject', parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string' } }, required: ['projectId'] } },
  { type: 'function', name: 'chat_alarmsList', parameters: { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean' } } } },
  { type: 'function', name: 'chat_collectionQuery', description: 'Generic read-only query across collections with a validated where DSL. Use to filter items by fields.', parameters: { type: 'object', additionalProperties: false, properties: { collection: { type: 'string' }, where: { type: 'object' }, select: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' }, sort: { type: 'object' } }, required: ['collection'] } },
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
                select: { type: 'array', items: { type: 'string' } }
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
    'Use chat_overdue for overdue items (<= now).',
    'Use chat_tasks with dueBefore for deadlines (e.g., tomorrow).',
    'Use chat_tasksByProject when a project id is specified.',
    'If the user names a project, first call chat_projectByName, then call chat_tasksByProject. You may omit projectId in the second step; the runtime will bind it from the previous result.',
    'Use chat_tasksFilter for status/tag filters.',
    'Use chat_semanticSearch for finding relevant documents by content.',
    'IMPORTANT: Include stopWhen.have to avoid unnecessary steps. Examples: ["lists.tasks"] after getting tasks, ["ids.projectId"] after finding project, ["lists.*"] when any list is populated.',
    'Leverage variable binding: use {"var":"ids.projectId"} to reference previously found IDs.',
    'Output JSON only that matches the schema. Keep at most 5 steps.'
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
    tools: CHAT_TOOLS_DEFINITION,
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
