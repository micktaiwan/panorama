// Response builder for MCP tools
// Implements human-readable outputs and explicability (Clever Cloud best practices)

/**
 * Build a structured success response with data, summary, and metadata
 *
 * @param {object} data - The actual data to return
 * @param {string} toolName - Name of the tool that generated this response
 * @param {object} options - Additional options
 * @param {string} options.source - Data source (e.g., 'panorama_db', 'gmail_cache', 'qdrant')
 * @param {string} options.policy - Access policy (e.g., 'read_only', 'write', 'delete')
 * @param {Date} options.cachedAt - When data was cached (if applicable)
 * @param {string} options.customSummary - Custom summary text (overrides auto-generated)
 * @param {boolean} options.includeHint - Include MCP-first hint in metadata (default: true)
 * @returns {object} Response object with output property
 */
export function buildSuccessResponse(data, toolName, options = {}) {
  const {
    source = 'panorama_db',
    policy = 'read_only',
    cachedAt = null,
    customSummary = null,
    includeHint = true
  } = options;

  // Auto-generate summary if not provided
  const summary = customSummary || generateSummary(data, toolName);

  const response = {
    data,
    summary,
    metadata: {
      source,
      policy,
      timestamp: new Date().toISOString(),
      ...(cachedAt && { cachedAt: cachedAt.toISOString() }),
      ...(includeHint && {
        hint: 'If this result is not what you expected, try different parameters or ask for a new MCP tool'
      })
    }
  };

  return {
    output: JSON.stringify(response)
  };
}

/**
 * Build a structured error response
 *
 * @param {Error|string} error - Error object or message
 * @param {string} toolName - Name of the tool that generated this error
 * @param {object} options - Additional options
 * @param {string} options.code - Error code (e.g., 'MISSING_PARAMETER', 'RESOURCE_NOT_FOUND')
 * @param {string} options.suggestion - Helpful suggestion for fixing the error
 * @returns {object} Response object with output property
 */
export function buildErrorResponse(error, toolName, options = {}) {
  const errorMessage = error?.message || String(error);
  const {
    code = 'TOOL_ERROR',
    suggestion = null
  } = options;

  const response = {
    error: {
      code,
      message: errorMessage,
      tool: toolName,
      timestamp: new Date().toISOString(),
      ...(suggestion && { suggestion })
    }
  };

  return {
    output: JSON.stringify(response)
  };
}

/**
 * Generate an intelligent human-readable summary from tool response data
 *
 * This makes it easier for LLMs to understand results without parsing JSON
 *
 * @param {object} data - Response data
 * @param {string} toolName - Name of the tool
 * @returns {string} Human-readable summary
 */
export function generateSummary(data, toolName) {
  // Extract common patterns
  const total = data?.total ?? null;
  const items = data?.tasks || data?.projects || data?.notes || data?.emails || data?.links || data?.files || [];
  const isListResult = Array.isArray(items) && items.length > 0;

  switch (toolName) {
    // Tasks
    case 'tool_tasksByProject':
    case 'tool_tasksFilter': {
      const urgentCount = items.filter(t => t.isUrgent).length;
      const importantCount = items.filter(t => t.isImportant).length;
      const overdueCount = items.filter(t => {
        if (!t.deadline) return false;
        const deadline = new Date(t.deadline);
        return deadline < new Date();
      }).length;

      let parts = [`Found ${total || items.length} task${items.length !== 1 ? 's' : ''}`];
      if (urgentCount > 0) parts.push(`${urgentCount} urgent`);
      if (importantCount > 0) parts.push(`${importantCount} important`);
      if (overdueCount > 0) parts.push(`${overdueCount} overdue`);

      return parts.join(', ');
    }

    // Projects
    case 'tool_projectsList':
      return `Found ${total || items.length} project${items.length !== 1 ? 's' : ''}`;

    case 'tool_projectByName': {
      const projects = data?.projects || [];
      if (projects.length === 0) {
        return 'No projects found';
      }
      if (projects.length === 1) {
        return `Found 1 project: "${projects[0].name}"`;
      }
      if (projects.length === 2) {
        return `Found 2 projects: "${projects[0].name}", "${projects[1].name}"`;
      }
      return `Found ${projects.length} projects`;
    }

    case 'tool_createProject': {
      const name = data?.name || 'unnamed';
      return `Created project "${name}"`;
    }

    case 'tool_updateProject':
      return `Updated project successfully`;

    case 'tool_projectsOverview': {
      const urgentProjects = items.filter(p => p.urgencyScore > 0.7).length;
      return `Panorama overview: ${items.length} project${items.length !== 1 ? 's' : ''}${urgentProjects > 0 ? `, ${urgentProjects} need attention` : ''}`;
    }

    // Semantic search
    case 'tool_semanticSearch': {
      const results = data?.results || [];
      const disabled = data?.disabled;
      if (disabled) return 'Semantic search disabled (Qdrant not configured)';
      return `Found ${results.length} semantic match${results.length !== 1 ? 'es' : ''}`;
    }

    // Notes
    case 'tool_notesByProject':
      return `Found ${total || items.length} note${items.length !== 1 ? 's' : ''}`;

    case 'tool_noteById': {
      const note = data?.note;
      return note
        ? `Retrieved note "${note.title}"`
        : 'Note not found';
    }

    case 'tool_notesByTitleOrContent': {
      const notes = data?.notes || [];
      if (notes.length === 0) return 'No notes found';
      if (notes.length === 1) return `Found 1 note: "${notes[0].title}"`;
      if (notes.length === 2) return `Found 2 notes: "${notes[0].title}", "${notes[1].title}"`;
      return `Found ${notes.length} notes`;
    }

    case 'tool_createNote': {
      const title = data?.title || 'untitled';
      return `Created note "${title}"`;
    }

    case 'tool_updateNote':
      return 'Updated note successfully';

    // Note sessions
    case 'tool_noteSessionsByProject':
      return `Found ${total || items.length} note session${items.length !== 1 ? 's' : ''}`;

    case 'tool_noteLinesBySession':
      return `Found ${total || items.length} note line${items.length !== 1 ? 's' : ''}`;

    // Links
    case 'tool_linksByProject':
      return `Found ${total || items.length} link${items.length !== 1 ? 's' : ''}`;

    case 'tool_createLink': {
      const name = data?.name || 'unnamed';
      return `Created link "${name}"`;
    }

    // People & Teams
    case 'tool_peopleList':
      return `Found ${total || items.length} person${items.length !== 1 ? 'people' : ''}`;

    case 'tool_teamsList':
      return `Found ${total || items.length} team${items.length !== 1 ? 's' : ''}`;

    // Files
    case 'tool_filesByProject':
      return `Found ${total || items.length} file${items.length !== 1 ? 's' : ''}`;

    // Alarms
    case 'tool_alarmsList': {
      const enabled = items.filter(a => a.enabled).length;
      return `Found ${total || items.length} alarm${items.length !== 1 ? 's' : ''} (${enabled} enabled)`;
    }

    case 'tool_createAlarm': {
      const title = data?.title || 'alarm';
      return `Created alarm "${title}"`;
    }

    // User logs
    case 'tool_userLogsFilter':
      return `Found ${total || items.length} journal entr${items.length !== 1 ? 'ies' : 'y'}`;

    // Tasks CRUD
    case 'tool_createTask': {
      const title = data?.title || 'untitled';
      return `Created task "${title}"`;
    }

    case 'tool_updateTask':
      return 'Updated task successfully';

    // Emails
    case 'tool_emailsUpdateCache': {
      const newCount = data?.newMessages || 0;
      const totalCount = data?.totalMessages || 0;
      return `Updated email cache: ${newCount} new message${newCount !== 1 ? 's' : ''} (${totalCount} total)`;
    }

    case 'tool_emailsSearch': {
      const method = data?.method || 'text';
      return `Found ${total || items.length} email${items.length !== 1 ? 's' : ''} using ${method} search`;
    }

    case 'tool_emailsRead': {
      const includeThread = data?.includeThread;
      return `Retrieved ${total || items.length} email${items.length !== 1 ? 's' : ''}${includeThread ? ' with thread' : ''}`;
    }

    // Generic collection query
    case 'tool_collectionQuery': {
      const collectionName = Object.keys(data).find(k => k !== 'total') || 'items';
      return `Found ${total || items.length} ${collectionName}`;
    }

    // Tools list
    case 'tool_listTools':
      return `Available: ${data?.tools?.length || 0} tools`;

    // Default fallback
    default:
      if (isListResult) {
        return `Found ${items.length} result${items.length !== 1 ? 's' : ''}`;
      }
      return 'Operation completed successfully';
  }
}

/**
 * Helper to extract source from tool context
 * Used to automatically determine data source for metadata
 *
 * @param {string} toolName - Name of the tool
 * @returns {string} Source identifier
 */
export function inferSource(toolName) {
  if (toolName.includes('email')) return 'gmail_cache';
  if (toolName === 'tool_semanticSearch') return 'qdrant';
  return 'panorama_db';
}

/**
 * Helper to extract policy from tool context
 * Used to automatically determine access policy for metadata
 *
 * @param {string} toolName - Name of the tool
 * @returns {string} Policy identifier
 */
export function inferPolicy(toolName) {
  if (toolName.startsWith('tool_create')) return 'write';
  if (toolName.startsWith('tool_update')) return 'write';
  if (toolName.startsWith('tool_delete')) return 'delete';
  return 'read_only';
}
