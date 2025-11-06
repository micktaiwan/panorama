# MCP Agents - Panorama Project

## Available Agents

### 1. panorama-assistant

**Purpose**: Task management, note organization, project planning, and workflow optimization within Panorama.

**Available MCP Servers**:
- **Panorama MCP**: Direct access to local Panorama database (tasks, notes, projects, links, files, alarms, user logs, emails)
- **Google Calendar MCP**: Calendar integration for event management and scheduling
- **Notion MCP**: Access to Notion workspaces for external documentation and databases

**Capabilities**:
- Create/update tasks, notes, projects, links
- Manage alarms and reminders
- Query and filter data across all collections
- Semantic search over workspace items
- Email management (Gmail integration via MCP)
- Calendar event creation and management
- Notion page/database read and write operations

**When to use**:
- Managing tasks and projects in Panorama
- Organizing notes and documentation
- Analyzing situations and workflows
- Email triage and inbox management
- Creating calendar events from tasks
- Synchronizing data with Notion

**Example prompts**:
- "Create a task to finish the report by tomorrow"
- "Show me all urgent tasks in the Alpha project"
- "Summarize my unread emails and create tasks for action items"
- "Create a calendar event for the team meeting next week"
- "Export project summary to a Notion page"

### 2. calendar-event-analyzer

**Purpose**: Specialized agent for Google Calendar integration.

**Available MCP Servers**:
- **Google Calendar MCP**: Full calendar management capabilities

**Capabilities**:
- List, search, create, update, delete calendar events
- Analyze calendar patterns and time allocation
- Handle recurring events
- Manage multiple calendars
- Check free/busy status

**When to use**:
- Analyzing upcoming calendar events
- Creating or modifying calendar events
- Getting insights about time allocation
- Managing meeting schedules

**Example prompts**:
- "What meetings do I have next week?"
- "Create a 1-hour meeting with the team tomorrow at 2pm"
- "How much time am I spending in meetings this month?"

## MCP Server Details

### Panorama MCP

**Tools available** (26 tools):
- **Projects**: list, get by name, create
- **Tasks**: filter, by project, create, update
- **Notes**: by project, by ID, create, update
- **Links**: by project, create
- **Emails**: update cache, search, read
- **Collections**: generic query with WHERE DSL
- **Search**: semantic search across all items
- **User logs**: filter by date range
- And more...

**Collections accessible via `tool_collectionQuery`**:
- tasks, projects, notes, noteSessions, noteLines
- links, people, teams, files, alarms, userLogs
- **emails** (Gmail messages)

### Google Calendar MCP

**Tools available**:
- list-calendars, list-events, search-events, get-event
- create-event, update-event, delete-event
- get-freebusy, get-current-time, list-colors

**Features**:
- Multiple calendar support
- Recurring events with modification scopes
- Conflict detection
- Google Meet integration
- Timezone handling

### Notion MCP

**Tools available**:
- **Search**: search by title
- **Pages**: retrieve, create, update
- **Databases**: query, retrieve, create, update
- **Blocks**: get children, append, update, delete
- **Users**: get user, list users
- **Comments**: retrieve, create
- **Properties**: retrieve page properties

**Features**:
- Rich text formatting
- Database relations and formulas
- Block-based content editing
- User and permission management

## Integration Patterns

### Panorama → Calendar
Create calendar events from Panorama tasks with deadlines.

### Panorama → Notion
Export project summaries, notes, or reports to Notion pages/databases.

### Calendar → Panorama
Import calendar events as tasks or notes.

### Email → Panorama → Calendar
Triage emails, create tasks, and schedule follow-up meetings.

### Multi-system workflow
1. Analyze emails (Panorama MCP)
2. Create tasks for action items (Panorama MCP)
3. Schedule meetings (Calendar MCP)
4. Document decisions (Notion MCP)
5. Update project status (Panorama MCP)

## Best Practices

### When to use panorama-assistant
- Use for multi-system workflows (emails + tasks + calendar + notion)
- Use for complex data queries and filtering
- Use for semantic search across workspace
- Use when you need context from multiple sources

### When to use calendar-event-analyzer
- Use for calendar-specific operations
- Use when analyzing time allocation patterns
- Use for recurring event management

### Direct MCP tool calls
- Use for simple, one-off operations
- Use when you know exactly which tool and parameters you need
- Faster than agent invocation for simple queries

## Configuration

MCP servers are configured in Claude Code settings. Ensure the following are properly set up:
- Panorama MCP server running on http://localhost:3000/mcp
- Google Calendar OAuth2 credentials configured
- Notion integration token set in environment variables

## Examples

### Complex workflow with panorama-assistant

```
User: "Check my unread emails, create tasks for anything urgent,
       and schedule a follow-up meeting for next week"

Agent will:
1. Use tool_emailsSearch to get unread emails
2. Analyze email content
3. Use tool_createTask for urgent items
4. Use create-event to schedule the meeting
5. Return summary of actions taken
```

### Notion integration

```
User: "Create a Notion page with a summary of my completed tasks this week"

Agent will:
1. Use tool_tasksFilter to get completed tasks
2. Format the summary
3. Use API-post-page to create Notion page
4. Return the page URL
```

## Troubleshooting

### Panorama MCP not responding
- Check that Meteor server is running (meteor)
- Verify MCP server is accessible at http://localhost:3000/mcp

### Calendar events not found
- Ensure Google Calendar OAuth2 tokens are valid
- Check calendar permissions in Google account

### Notion tools failing
- Verify Notion integration token is set
- Check page/database permissions in Notion workspace

## Future Enhancements

Potential improvements to the agent architecture:
- Specialized Notion agent for complex documentation workflows
- Email agent for advanced triage and categorization
- Project management agent combining all systems
- Custom agents for specific business workflows
