// Tool handlers - implements all tools
// Shared by Chat and MCP server
// Enhanced with structured responses (Clever Cloud MCP best practices)

import { Meteor } from 'meteor/meteor';
import { getQdrantUrl } from '/imports/api/_shared/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { COLLECTION } from '/imports/api/search/vectorStore';
import {
  buildProjectByNameSelector,
  buildByProjectSelector,
  buildFilterSelector,
  compileWhere,
  getListKeyForCollection,
  FIELD_ALLOWLIST
} from '/imports/api/tools/helpers';
import {
  buildSuccessResponse,
  buildErrorResponse,
  inferSource,
  inferPolicy
} from '/imports/api/tools/responseBuilder';

// Utility functions
const clampText = (s, max = 300) => {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

const embedQuery = async (text) => {
  const { embedText } = await import('/imports/api/search/vectorStore');
  return embedText(text);
};

const fetchPreview = async (kind, rawId) => {
  const id = String(rawId || '').split(':').pop();
  switch (kind) {
    case 'project': {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const p = await ProjectsCollection.findOneAsync({ _id: id }, { fields: { name: 1, description: 1 } });
      if (!p) return { title: '(project)', text: '' };
      return { title: p.name || '(project)', text: `${p.name || ''} ${p.description || ''}`.trim() };
    }
    case 'task': {
      const { TasksCollection } = await import('/imports/api/tasks/collections');
      const t = await TasksCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
      return { title: t?.title || '(task)', text: t?.title || '' };
    }
    case 'note': {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      const n = await NotesCollection.findOneAsync({ _id: id }, { fields: { title: 1, content: 1 } });
      return { title: n?.title || '(note)', text: `${n?.title || ''} ${n?.content || ''}`.trim() };
    }
    case 'session': {
      const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
      const s = await NoteSessionsCollection.findOneAsync({ _id: id }, { fields: { name: 1, aiSummary: 1 } });
      return { title: s?.name || '(session)', text: `${s?.name || ''} ${s?.aiSummary || ''}`.trim() };
    }
    case 'line': {
      const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
      const l = await NoteLinesCollection.findOneAsync({ _id: id }, { fields: { content: 1 } });
      return { title: '(line)', text: l?.content || '' };
    }
    case 'alarm': {
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      const a = await AlarmsCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
      return { title: a?.title || '(alarm)', text: a?.title || '' };
    }
    case 'link': {
      const { LinksCollection } = await import('/imports/api/links/collections');
      const l = await LinksCollection.findOneAsync({ _id: id }, { fields: { name: 1, url: 1 } });
      return { title: l?.name || '(link)', text: `${l?.name || ''} ${l?.url || ''}`.trim(), url: l?.url || '' };
    }
    default:
      return { title: '(doc)', text: '' };
  }
};

// Tool handlers object
export const TOOL_HANDLERS = {
  async tool_listTools(args, memory) {
    const { TOOL_DEFINITIONS } = await import('/imports/api/tools/definitions');
    const tools = TOOL_DEFINITIONS.map(tool => ({
      name: tool.name || '',
      description: tool.description || '',
      parameters: tool.parameters?.properties ? Object.keys(tool.parameters.properties) : [],
      required: tool.parameters?.required || []
    }));
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.tools = tools;
    }
    return buildSuccessResponse(
      { tools, total: tools.length },
      'tool_listTools',
      { source: 'panorama_server', policy: 'read_only' }
    );
  },
  async tool_tasksByProject(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const selector = buildByProjectSelector(args?.projectId);
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1, notes: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    // Include IDs for MCP clients to chain tool calls
    const mapped = (tasks || []).map(t => ({ id: t._id, projectId: t.projectId, title: clampText(t.title || ''), notes: t.notes || '', status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory && Array.isArray(tasks)) {
      memory.tasks = tasks;
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return buildSuccessResponse(
      { tasks: mapped, total: mapped.length },
      'tool_tasksByProject'
    );
  },
  async tool_tasksFilter(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const selector = buildFilterSelector(args || {});
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1, notes: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    // Include IDs for MCP clients to chain tool calls
    const mapped = (tasks || []).map(t => ({ id: t._id, projectId: t.projectId, title: clampText(t.title || ''), notes: t.notes || '', status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory) {
      memory.tasks = tasks || [];
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return buildSuccessResponse(
      { tasks: mapped, total: mapped.length },
      'tool_tasksFilter'
    );
  },
  async tool_projectsList(args, memory) {
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
    // Include IDs for MCP clients to chain tool calls
    const compact = (projects || []).map(p => ({ id: p._id, name: clampText(p.name || ''), description: clampText(p.description || '') }));
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.projects = compact;
    }
    return buildSuccessResponse(
      { projects: compact, total: compact.length },
      'tool_projectsList'
    );
  },
  async tool_projectByName(args, memory) {
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const selector = buildProjectByNameSelector(args?.name);
    const proj = await ProjectsCollection.findOneAsync(selector, { fields: { name: 1, description: 1 } });
    if (proj?._id && memory) {
      // Standardize on new generic memory structure
      memory.ids = memory.ids || {};
      memory.ids.projectId = proj._id;
      memory.entities = memory.entities || {};
      memory.entities.project = { name: proj.name || '', description: proj.description || '' };
      // Keep legacy for backward compatibility during transition
      memory.projectId = proj._id;
      memory.projectName = proj.name || null;
    }
    const out = proj ? { id: proj._id, name: clampText(proj.name || ''), description: clampText(proj.description || '') } : null;
    return buildSuccessResponse(
      { project: out },
      'tool_projectByName'
    );
  },
  async tool_createProject(args, memory) {
    const name = String(args?.name || '').trim();
    if (!name) {
      return buildErrorResponse('name is required', 'tool_createProject', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide a project name, e.g., {name: "My Project"}'
      });
    }

    try {
      const doc = { name };

      if (args?.description) doc.description = String(args.description);
      if (args?.status) doc.status = String(args.status);

      const projectId = await Meteor.callAsync('projects.insert', doc);

      const result = { projectId, name, description: doc.description || null };
      if (memory) {
        memory.ids = memory.ids || {};
        memory.ids.projectId = projectId;
        memory.entities = memory.entities || {};
        memory.entities.project = { name, description: doc.description || '' };
      }

      return buildSuccessResponse(result, 'tool_createProject', { policy: 'write' });
    } catch (error) {
      return buildErrorResponse(error, 'tool_createProject');
    }
  },
  async tool_updateProject(args, memory) {
    const projectId = String(args?.projectId || '').trim();
    if (!projectId) {
      return buildErrorResponse('projectId is required', 'tool_updateProject', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide the project ID to update, e.g., {projectId: "abc123"}'
      });
    }

    const modifier = {};
    if (args?.name !== undefined) modifier.name = String(args.name);
    if (args?.description !== undefined) modifier.description = String(args.description);
    if (args?.status !== undefined) modifier.status = String(args.status);

    if (Object.keys(modifier).length === 0) {
      return buildErrorResponse('At least one field must be provided', 'tool_updateProject', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide at least one of: name, description, or status'
      });
    }

    try {
      await Meteor.callAsync('projects.update', projectId, modifier);

      const result = { success: true, projectId, updated: modifier };
      if (memory) {
        memory.ids = memory.ids || {};
        memory.ids.projectId = projectId;
      }

      return buildSuccessResponse(result, 'tool_updateProject', { policy: 'write' });
    } catch (error) {
      return buildErrorResponse(error, 'tool_updateProject');
    }
  },
  async tool_projectsOverview(args, memory) {
    const periodDays = Number(args?.periodDays) || 14;

    try {
      // Call the panorama.getOverview method (wrapper pattern)
      const overview = await Meteor.callAsync('panorama.getOverview', { periodDays });

      // Store in memory for tool chaining
      if (memory) {
        memory.lists = memory.lists || {};
        memory.lists.projects = overview;
      }

      return buildSuccessResponse({
        projects: overview,
        total: overview.length,
        periodDays
      }, 'tool_projectsOverview');
    } catch (error) {
      return buildErrorResponse(error, 'tool_projectsOverview');
    }
  },
  async tool_semanticSearch(args, memory) {
    const limit = Math.max(1, Math.min(50, Number(args?.limit) || 8));
    const q = String(args?.query || '').trim();
    const url = getQdrantUrl();
    if (!url) {
      if (memory) { memory.lists = memory.lists || {}; memory.lists.searchResults = []; }
      return buildSuccessResponse(
        { results: [], total: 0, disabled: true },
        'tool_semanticSearch',
        { source: 'qdrant', customSummary: 'Semantic search disabled (Qdrant not configured)' }
      );
    }
    try {
      const client = new QdrantClient({ url });
      const vector = await embedQuery(q);
      const searchRes = await client.search(COLLECTION(), { vector, limit, with_payload: true });
      const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
      const out = await Promise.all(items.map(async (it) => {
        const p = it?.payload || {};
        const prev = await fetchPreview(p.kind, p.docId);
        return { kind: p.kind, id: p.docId, title: prev.title, url: prev.url || null, score: it?.score || 0 };
      }));
      if (memory) {
        memory.lists = memory.lists || {};
        memory.lists.searchResults = out;
      }
      return buildSuccessResponse(
        { results: out, total: out.length },
        'tool_semanticSearch',
        { source: 'qdrant' }
      );
    } catch (error) {
      return buildErrorResponse(error, 'tool_semanticSearch', {
        suggestion: 'Check that Qdrant is running and accessible'
      });
    }
  },
  async tool_collectionQuery(args, memory) {
    const collection = String(args?.collection || '').trim();
    const where = args?.where ? args.where : {};
    const select = Array.isArray(args?.select) ? args.select.filter(f => FIELD_ALLOWLIST[collection]?.includes(f)) : [];
    const sort = args?.sort || {};

    try {
      const selector = compileWhere(collection, where);
      let cursor;
      if (collection === 'tasks') {
        const { TasksCollection } = await import('/imports/api/tasks/collections');
        cursor = TasksCollection;
      } else if (collection === 'projects') {
        const { ProjectsCollection } = await import('/imports/api/projects/collections');
        cursor = ProjectsCollection;
      } else if (collection === 'notes') {
        const { NotesCollection } = await import('/imports/api/notes/collections');
        cursor = NotesCollection;
      } else if (collection === 'noteSessions') {
        const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
        cursor = NoteSessionsCollection;
      } else if (collection === 'noteLines') {
        const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
        cursor = NoteLinesCollection;
      } else if (collection === 'links') {
        const { LinksCollection } = await import('/imports/api/links/collections');
        cursor = LinksCollection;
      } else if (collection === 'people') {
        const { PeopleCollection } = await import('/imports/api/people/collections');
        cursor = PeopleCollection;
      } else if (collection === 'teams') {
        const { TeamsCollection } = await import('/imports/api/teams/collections');
        cursor = TeamsCollection;
      } else if (collection === 'files') {
        const { FilesCollection } = await import('/imports/api/files/collections');
        cursor = FilesCollection;
      } else if (collection === 'alarms') {
        const { AlarmsCollection } = await import('/imports/api/alarms/collections');
        cursor = AlarmsCollection;
      } else if (collection === 'userLogs') {
        const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
        cursor = UserLogsCollection;
      } else if (collection === 'emails') {
        const { GmailMessagesCollection } = await import('/imports/api/emails/collections');
        cursor = GmailMessagesCollection;
      } else if (collection === 'mcpServers') {
        const { MCPServersCollection } = await import('/imports/api/mcpServers/collections');
        cursor = MCPServersCollection;
      } else if (collection === 'notionIntegrations') {
        const { NotionIntegrationsCollection } = await import('/imports/api/notionIntegrations/collections');
        cursor = NotionIntegrationsCollection;
      } else if (collection === 'notionTickets') {
        const { NotionTicketsCollection } = await import('/imports/api/notionTickets/collections');
        cursor = NotionTicketsCollection;
      } else {
        return buildErrorResponse(`Unsupported collection: ${collection}`, 'tool_collectionQuery', {
          code: 'INVALID_COLLECTION',
          suggestion: 'Use one of: tasks, projects, notes, noteSessions, noteLines, links, people, teams, files, alarms, userLogs, emails, mcpServers, notionIntegrations, notionTickets'
        });
      }
      const fields = select.length > 0 ? Object.fromEntries(select.map(f => [f, 1])) : undefined;
      const limit = Math.min(200, Math.max(1, Number(args?.limit) || 50));
      const docs = await cursor.find(selector, { fields, sort, limit }).fetchAsync();
      const key = getListKeyForCollection(collection);
      const list = Array.isArray(docs) ? docs : [];
      if (memory) {
        memory.lists = memory.lists || {};
        memory.lists[key] = list;
      }
      return buildSuccessResponse(
        { [key]: list, total: list.length },
        'tool_collectionQuery'
      );
    } catch (error) {
      return buildErrorResponse(error, 'tool_collectionQuery');
    }
  },
  async tool_notesByProject(args, memory) {
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const projectId = String(args?.projectId || '').trim();
    const notes = await NotesCollection.find({ projectId }, { fields: { title: 1 } }).fetchAsync();
    const mapped = (notes || []).map(n => ({ id: n._id, title: clampText(n.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.notes = mapped; }
    return buildSuccessResponse({ notes: mapped, total: mapped.length }, 'tool_notesByProject');
  },
  async tool_noteById(args, memory) {
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const noteId = String(args?.noteId || '').trim();
    if (!noteId) {
      return buildErrorResponse('noteId is required', 'tool_noteById', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide a valid note ID, e.g., {noteId: "abc123"}'
      });
    }
    const note = await NotesCollection.findOneAsync(
      { _id: noteId },
      { fields: { title: 1, content: 1, projectId: 1, createdAt: 1, updatedAt: 1 } }
    );
    if (!note) {
      return buildSuccessResponse({ note: null }, 'tool_noteById', {
        customSummary: 'Note not found'
      });
    }
    const result = {
      id: note._id,
      title: note.title || '',
      content: note.content || '',
      projectId: note.projectId || null,
      createdAt: note.createdAt ? note.createdAt.toISOString() : null,
      updatedAt: note.updatedAt ? note.updatedAt.toISOString() : null
    };
    if (memory) { memory.entities = memory.entities || {}; memory.entities.note = result; }
    return buildSuccessResponse({ note: result }, 'tool_noteById');
  },
  async tool_noteSessionsByProject(args, memory) {
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const projectId = String(args?.projectId || '').trim();
    const sessions = await NoteSessionsCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (sessions || []).map(s => ({ id: s._id, name: clampText(s.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteSessions = mapped; }
    return buildSuccessResponse({ sessions: mapped, total: mapped.length }, 'tool_noteSessionsByProject');
  },
  async tool_noteLinesBySession(args, memory) {
    const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
    const sessionId = String(args?.sessionId || '').trim();
    const lines = await NoteLinesCollection.find({ sessionId }, { fields: { content: 1 } }).fetchAsync();
    const mapped = (lines || []).map(l => ({ id: l._id, content: clampText(l.content || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteLines = mapped; }
    return buildSuccessResponse({ lines: mapped, total: mapped.length }, 'tool_noteLinesBySession');
  },
  async tool_linksByProject(args, memory) {
    const { LinksCollection } = await import('/imports/api/links/collections');
    const projectId = String(args?.projectId || '').trim();
    const links = await LinksCollection.find({ projectId }, { fields: { name: 1, url: 1 } }).fetchAsync();
    const mapped = (links || []).map(l => ({ id: l._id, name: clampText(l.name || ''), url: l.url || null }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.links = mapped; }
    return buildSuccessResponse({ links: mapped, total: mapped.length }, 'tool_linksByProject');
  },
  async tool_peopleList(args, memory) {
    const { PeopleCollection } = await import('/imports/api/people/collections');
    const people = await PeopleCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (people || []).map(p => ({ id: p._id, name: clampText(p.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.people = mapped; }
    return buildSuccessResponse({ people: mapped, total: mapped.length }, 'tool_peopleList');
  },
  async tool_teamsList(args, memory) {
    const { TeamsCollection } = await import('/imports/api/teams/collections');
    const teams = await TeamsCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (teams || []).map(t => ({ id: t._id, name: clampText(t.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.teams = mapped; }
    return buildSuccessResponse({ teams: mapped, total: mapped.length }, 'tool_teamsList');
  },
  async tool_filesByProject(args, memory) {
    const { FilesCollection } = await import('/imports/api/files/collections');
    const projectId = String(args?.projectId || '').trim();
    const files = await FilesCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (files || []).map(f => ({ id: f._id, name: clampText(f.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.files = mapped; }
    return buildSuccessResponse({ files: mapped, total: mapped.length }, 'tool_filesByProject');
  },
  async tool_alarmsList(args, memory) {
    const { AlarmsCollection } = await import('/imports/api/alarms/collections');
    const enabled = (typeof args?.enabled === 'boolean') ? args.enabled : undefined;
    const sel = (typeof enabled === 'boolean') ? { enabled } : {};
    const alarms = await AlarmsCollection.find(sel, { fields: { title: 1 } }).fetchAsync();
    const mapped = (alarms || []).map(a => ({ id: a._id, title: clampText(a.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.alarms = mapped; }
    return buildSuccessResponse({ alarms: mapped, total: mapped.length }, 'tool_alarmsList');
  },
  async tool_createAlarm(args, memory) {
    const title = String(args?.title || '').trim();
    const nextTriggerAt = args?.nextTriggerAt;

    if (!title) {
      return buildErrorResponse('title is required', 'tool_createAlarm', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide title parameter, e.g., {title: "Morning standup"}'
      });
    }

    if (!nextTriggerAt) {
      return buildErrorResponse('nextTriggerAt is required', 'tool_createAlarm', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide nextTriggerAt as ISO date, e.g., {nextTriggerAt: "2025-10-31T08:00:00"}'
      });
    }

    const doc = {
      title,
      nextTriggerAt,
      enabled: args?.enabled !== false
    };

    if (args?.recurrence) {
      doc.recurrence = args.recurrence;
    }

    const alarmId = await Meteor.callAsync('alarms.insert', doc);

    const result = { alarmId, title, nextTriggerAt };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.alarmId = alarmId;
    }

    return buildSuccessResponse(result, 'tool_createAlarm', { source: 'panorama_db', policy: 'write' });
  },
  async tool_createTask(args, memory) {
    const title = String(args?.title || '').trim();
    if (!title) {
      return buildErrorResponse('title is required', 'tool_createTask', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide title parameter'
      });
    }

    const doc = {
      title,
      status: args?.status || 'todo'
    };

    if (args?.projectId) doc.projectId = String(args.projectId).trim();
    if (args?.notes) doc.notes = String(args.notes);
    if (args?.deadline) doc.deadline = String(args.deadline);
    if (typeof args?.isUrgent === 'boolean') doc.isUrgent = args.isUrgent;
    if (typeof args?.isImportant === 'boolean') doc.isImportant = args.isImportant;

    const taskId = await Meteor.callAsync('tasks.insert', doc);

    const result = { taskId, title, projectId: doc.projectId || null };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.taskId = taskId;
    }

    return buildSuccessResponse(result, 'tool_createTask', { policy: 'write' });
  },
  async tool_updateTask(args, memory) {
    const taskId = String(args?.taskId || '').trim();
    if (!taskId) {
      return buildErrorResponse('taskId is required', 'tool_updateTask', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide taskId parameter'
      });
    }

    const modifier = {};

    if (args?.title) modifier.title = String(args.title);
    if (args?.notes !== undefined) modifier.notes = String(args.notes || '');
    if (args?.status) modifier.status = String(args.status);
    if (args?.deadline !== undefined) modifier.deadline = args.deadline ? String(args.deadline) : null;
    if (args?.projectId !== undefined) modifier.projectId = args.projectId ? String(args.projectId).trim() : null;
    if (typeof args?.isUrgent === 'boolean') modifier.isUrgent = args.isUrgent;
    if (typeof args?.isImportant === 'boolean') modifier.isImportant = args.isImportant;

    if (Object.keys(modifier).length === 0) {
      return buildErrorResponse('No fields to update', 'tool_updateTask', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide at least one field to update'
      });
    }

    await Meteor.callAsync('tasks.update', taskId, modifier);

    const result = { updated: true, taskId };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.taskId = taskId;
    }

    return buildSuccessResponse(result, 'tool_updateTask', { policy: 'write' });
  },
  async tool_createNote(args, memory) {
    const title = String(args?.title || '').trim();
    if (!title) {
      return buildErrorResponse('title is required', 'tool_createNote', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide title parameter'
      });
    }

    const doc = { title };

    if (args?.content) doc.content = String(args.content);
    if (args?.projectId) doc.projectId = String(args.projectId).trim();

    const noteId = await Meteor.callAsync('notes.insert', doc);

    const result = { noteId, title, projectId: doc.projectId || null };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.noteId = noteId;
    }

    return buildSuccessResponse(result, 'tool_createNote', { policy: 'write' });
  },
  async tool_updateNote(args, memory) {
    const noteId = String(args?.noteId || '').trim();
    if (!noteId) {
      return buildErrorResponse('noteId is required', 'tool_updateNote', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide noteId parameter'
      });
    }

    const modifier = {};

    if (args?.title) modifier.title = String(args.title);
    if (args?.content !== undefined) modifier.content = String(args.content || '');
    if (args?.projectId !== undefined) modifier.projectId = args.projectId ? String(args.projectId).trim() : null;

    if (Object.keys(modifier).length === 0) {
      return buildErrorResponse('No fields to update', 'tool_updateNote', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide at least one field to update'
      });
    }

    await Meteor.callAsync('notes.update', noteId, modifier);

    const result = { updated: true, noteId };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.noteId = noteId;
    }

    return buildSuccessResponse(result, 'tool_updateNote', { policy: 'write' });
  },
  async tool_deleteNote(args, memory) {
    const noteId = String(args?.noteId || '').trim();
    if (!noteId) {
      return buildErrorResponse('noteId is required', 'tool_deleteNote', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide noteId parameter'
      });
    }

    try {
      await Meteor.callAsync('notes.remove', noteId);

      const result = { deleted: true, noteId };
      if (memory) {
        memory.ids = memory.ids || {};
        memory.ids.noteId = noteId;
      }

      return buildSuccessResponse(result, 'tool_deleteNote', { policy: 'write' });
    } catch (error) {
      return buildErrorResponse(error, 'tool_deleteNote');
    }
  },
  async tool_createLink(args, memory) {
    const name = String(args?.name || '').trim();
    const url = String(args?.url || '').trim();

    if (!name) {
      return buildErrorResponse('name is required', 'tool_createLink', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide name parameter'
      });
    }
    if (!url) {
      return buildErrorResponse('url is required', 'tool_createLink', {
        code: 'MISSING_PARAMETER',
        suggestion: 'Provide url parameter'
      });
    }

    const doc = { name, url };

    if (args?.projectId) doc.projectId = String(args.projectId).trim();

    const linkId = await Meteor.callAsync('links.insert', doc);

    const result = { linkId, name, url, projectId: doc.projectId || null };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.linkId = linkId;
    }

    return buildSuccessResponse(result, 'tool_createLink', { policy: 'write' });
  },
  async tool_userLogsFilter(args, memory) {
    const { UserLogsCollection } = await import('/imports/api/userLogs/collections');

    const selector = {};

    // Filter by lastDays if provided
    const hasDateFilter = args?.lastDays && Number(args.lastDays) > 0;
    if (hasDateFilter) {
      const daysAgo = Number(args.lastDays);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      selector.createdAt = { $gte: cutoffDate };
    }

    // If lastDays is specified, default to unlimited (max 1000), otherwise limit to 50
    const defaultLimit = hasDateFilter ? 1000 : 50;
    const limit = Math.min(1000, Math.max(1, Number(args?.limit) || defaultLimit));
    const logs = await UserLogsCollection.find(selector, {
      fields: { content: 1, createdAt: 1 },
      sort: { createdAt: -1 },
      limit
    }).fetchAsync();

    const mapped = (logs || []).map(l => ({
      id: l._id,
      content: clampText(l.content || '', 500),
      createdAt: l.createdAt ? l.createdAt.toISOString() : null
    }));

    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.userLogs = mapped;
    }

    return buildSuccessResponse({ userLogs: mapped, total: mapped.length }, 'tool_userLogsFilter');
  },
  async tool_emailsUpdateCache(args, memory) {
    const maxResults = Math.min(500, Math.max(1, Number(args?.maxResults) || 20));

    try {
      // Call the Gmail method to fetch and cache new messages
      const result = await Meteor.callAsync('gmail.listMessages', '', maxResults);

      const summary = {
        success: true,
        totalMessages: result?.totalMessages || 0,
        newMessages: result?.newMessagesCount || 0,
        successCount: result?.successCount || 0,
        errorCount: result?.errorCount || 0,
        syncedCount: result?.syncedCount || 0,
        syncSuccessCount: result?.syncSuccessCount || 0,
        syncErrorCount: result?.syncErrorCount || 0
      };

      if (memory) {
        memory.lists = memory.lists || {};
        memory.lists.emailCacheUpdate = [summary];
      }

      return buildSuccessResponse(summary, 'tool_emailsUpdateCache', { source: 'gmail', policy: 'write' });
    } catch (error) {
      console.error('[tool_emailsUpdateCache] Error:', error);
      return buildErrorResponse(error, 'tool_emailsUpdateCache');
    }
  },
  async tool_emailsSearch(args, memory) {
    const query = String(args?.query || '').trim();
    if (!query) {
    return buildErrorResponse('query is required', 'tool_emailsSearch', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide a search query, e.g., {query: "from:sender@example.com"}'
    });
  }

    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
    const useSemanticSearch = !!args?.useSemanticSearch;

    const { GmailMessagesCollection } = await import('/imports/api/emails/collections');

    let emails = [];

    if (useSemanticSearch) {
      // Use semantic search through Qdrant
      try {
        const url = getQdrantUrl();
        if (!url) {
          return buildErrorResponse('Qdrant is not configured for semantic search', 'tool_emailsSearch', {
    code: 'SERVICE_UNAVAILABLE',
    suggestion: 'Configure Qdrant in Preferences or use text search instead'
  });
        }

        const client = new QdrantClient({ url });
        const vector = await embedQuery(query);

        const searchRes = await client.search(COLLECTION(), {
          vector,
          limit,
          with_payload: true,
          filter: {
            must: [{ key: 'kind', match: { value: 'email' } }]
          }
        });

        const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
        const emailIds = items.map(it => it?.payload?.docId).filter(Boolean);

        // Fetch full email data from MongoDB
        emails = await GmailMessagesCollection.find(
          { id: { $in: emailIds } },
          { fields: { id: 1, from: 1, subject: 1, snippet: 1, gmailDate: 1, labelIds: 1 } }
        ).fetchAsync();

        // Sort by vector search score order
        const idOrder = new Map(emailIds.map((id, idx) => [id, idx]));
        emails.sort((a, b) => (idOrder.get(a.id) || 999) - (idOrder.get(b.id) || 999));
      } catch (error) {
        console.error('[tool_emailsSearch] Semantic search error:', error);
        return buildErrorResponse(error, 'tool_emailsSearch', {
    suggestion: 'Check that Qdrant is running and accessible'
  });
      }
    } else {
      // Parse Gmail-style query syntax with support for combined queries
      const conditions = [];
      let remainingText = query;

      // Helper function to escape regex special characters
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Extract all operators from the query
      const operators = {
        'is:': /\bis:(unread|read|starred|important|inbox|trash)\b/gi,
        'in:': /\bin:(inbox|trash)\b/gi,
        'from:': /\bfrom:([^\s]+)/gi,
        '-from:': /\b-from:([^\s]+)/gi,
        'subject:': /\bsubject:([^\s]+)/gi,
        '-subject:': /\b-subject:([^\s]+)/gi,
        'to:': /\bto:([^\s]+)/gi
      };

      // Process is: operator
      let match;
      while ((match = operators['is:'].exec(query)) !== null) {
        const operator = match[1].toLowerCase();
        remainingText = remainingText.replace(match[0], '').trim();

        switch (operator) {
          case 'unread':
            conditions.push({ labelIds: { $in: ['UNREAD'] } });
            break;
          case 'read':
            conditions.push({ labelIds: { $nin: ['UNREAD'] } });
            break;
          case 'starred':
            conditions.push({ labelIds: { $in: ['STARRED'] } });
            break;
          case 'important':
            conditions.push({ labelIds: { $in: ['IMPORTANT'] } });
            break;
          case 'inbox':
            conditions.push({ labelIds: { $in: ['INBOX'] } });
            break;
          case 'trash':
            conditions.push({ labelIds: { $in: ['TRASH'] } });
            break;
        }
      }

      // Process in: operator
      while ((match = operators['in:'].exec(query)) !== null) {
        const location = match[1].toLowerCase();
        remainingText = remainingText.replace(match[0], '').trim();

        switch (location) {
          case 'inbox':
            conditions.push({ labelIds: { $in: ['INBOX'] } });
            break;
          case 'trash':
            conditions.push({ labelIds: { $in: ['TRASH'] } });
            break;
        }
      }

      // Process from: operator
      while ((match = operators['from:'].exec(query)) !== null) {
        const fromValue = match[1];
        remainingText = remainingText.replace(match[0], '').trim();
        const textRegex = new RegExp(escapeRegex(fromValue), 'i');
        conditions.push({ from: textRegex });
      }

      // Process -from: operator (negation)
      while ((match = operators['-from:'].exec(query)) !== null) {
        const fromValue = match[1];
        remainingText = remainingText.replace(match[0], '').trim();
        const textRegex = new RegExp(escapeRegex(fromValue), 'i');
        conditions.push({ from: { $not: textRegex } });
      }

      // Process subject: operator
      while ((match = operators['subject:'].exec(query)) !== null) {
        const subjectValue = match[1];
        remainingText = remainingText.replace(match[0], '').trim();
        const textRegex = new RegExp(escapeRegex(subjectValue), 'i');
        conditions.push({ subject: textRegex });
      }

      // Process -subject: operator (negation)
      while ((match = operators['-subject:'].exec(query)) !== null) {
        const subjectValue = match[1];
        remainingText = remainingText.replace(match[0], '').trim();
        const textRegex = new RegExp(escapeRegex(subjectValue), 'i');
        conditions.push({ subject: { $not: textRegex } });
      }

      // Process to: operator
      while ((match = operators['to:'].exec(query)) !== null) {
        const toValue = match[1];
        remainingText = remainingText.replace(match[0], '').trim();
        const textRegex = new RegExp(escapeRegex(toValue), 'i');
        conditions.push({ to: textRegex });
      }

      // If there's remaining text, add it as full-text search
      remainingText = remainingText.trim();
      if (remainingText) {
        const textRegex = new RegExp(escapeRegex(remainingText), 'i');
        conditions.push({
          $or: [
            { from: textRegex },
            { subject: textRegex },
            { snippet: textRegex },
            { body: textRegex }
          ]
        });
      }

      // Build final selector
      let selector = {};
      if (conditions.length === 0) {
        // If no conditions were extracted (shouldn't happen), do full-text search on original query
        const textRegex = new RegExp(escapeRegex(query), 'i');
        selector = {
          $or: [
            { from: textRegex },
            { subject: textRegex },
            { snippet: textRegex },
            { body: textRegex }
          ]
        };
      } else if (conditions.length === 1) {
        // Single condition
        selector = conditions[0];
      } else {
        // Multiple conditions - combine with $and
        selector = { $and: conditions };
      }

      emails = await GmailMessagesCollection.find(selector, {
        fields: { id: 1, from: 1, subject: 1, snippet: 1, gmailDate: 1, labelIds: 1 },
        sort: { gmailDate: -1 },
        limit
      }).fetchAsync();
    }

    const mapped = (emails || []).map(e => ({
      id: e.id,
      mongoId: e._id,
      from: clampText(e.from || '', 100),
      subject: clampText(e.subject || '', 200),
      snippet: clampText(e.snippet || '', 300),
      date: e.gmailDate ? new Date(e.gmailDate).toISOString() : null,
      labels: e.labelIds || []
    }));

    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.emails = mapped;
    }

    return buildSuccessResponse({ emails: mapped, total: mapped.length, query, method: useSemanticSearch ? 'semantic' : 'text' }, 'tool_emailsSearch', { source: 'gmail_cache' });
  },
  async tool_emailsRead(args, memory) {
    const emailIds = Array.isArray(args?.emailIds) ? args.emailIds : [];
    if (emailIds.length === 0) {
    return buildErrorResponse('emailIds array is required and cannot be empty', 'tool_emailsRead', {
      code: 'MISSING_PARAMETER',
      suggestion: 'Provide at least one email ID to read'
    });
  }

    const includeThread = !!args?.includeThread;
    const { GmailMessagesCollection } = await import('/imports/api/emails/collections');

    const emails = [];

    for (const emailId of emailIds) {
      const id = String(emailId).trim();

      // Try to find by Gmail ID first, then by MongoDB _id
      let email = await GmailMessagesCollection.findOneAsync({ id });
      if (!email) {
        email = await GmailMessagesCollection.findOneAsync({ _id: id });
      }

      if (!email) {
        console.warn(`[tool_emailsRead] Email not found: ${id}`);
        continue;
      }

      const emailData = {
        id: email.id,
        mongoId: email._id,
        threadId: email.threadId,
        from: email.from || '',
        to: email.to || '',
        subject: email.subject || '',
        snippet: email.snippet || '',
        body: email.body || '',
        date: email.gmailDate ? new Date(email.gmailDate).toISOString() : null,
        labels: email.labelIds || []
      };

      // If includeThread is true, fetch all messages in the thread
      if (includeThread && email.threadId) {
        try {
          const threadMessages = await Meteor.callAsync('gmail.getThreadMessages', email.threadId);
          emailData.threadMessages = (threadMessages || []).map(tm => ({
            id: tm.id,
            from: tm.from || '',
            to: tm.to || '',
            subject: tm.subject || '',
            snippet: tm.snippet || '',
            body: tm.body || '',
            date: tm.gmailDate ? new Date(tm.gmailDate).toISOString() : null
          }));
        } catch (threadError) {
          console.error(`[tool_emailsRead] Failed to get thread messages:`, threadError);
          emailData.threadMessages = [];
        }
      }

      emails.push(emailData);
    }

    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.emailsRead = emails;
    }

    return buildSuccessResponse({ emails, total: emails.length, includeThread }, 'tool_emailsRead', { source: 'gmail_cache' });
  },

  async tool_emailsListLabels(args, memory) {
    try {
      const labels = await Meteor.callAsync('gmail.listLabels');

      // Format labels for easier use
      const formattedLabels = labels.map(label => ({
        id: label.id,
        name: label.name,
        type: label.type,
        messageListVisibility: label.messageListVisibility || 'show',
        labelListVisibility: label.labelListVisibility || 'labelShow'
      }));

      if (memory) {
        memory.lists = memory.lists || {};
        memory.lists.gmailLabels = formattedLabels;
      }

      return buildSuccessResponse({ labels: formattedLabels, total: formattedLabels.length }, 'tool_emailsListLabels', { source: 'gmail' });
    } catch (error) {
      console.error('[tool_emailsListLabels] Error:', error);
      throw new Error(`Failed to list Gmail labels: ${error.message}`);
    }
  },

  async tool_emailsAddLabel(args, memory) {
    const { messageId, labelId } = args;

    if (!messageId) throw new Error('messageId is required');
    if (!labelId) throw new Error('labelId is required');

    try {
      // messageId might be MongoDB _id or Gmail id - need to resolve to Gmail id
      const { GmailMessagesCollection } = await import('/imports/api/emails/collections');
      let gmailMessageId = messageId;

      // If it looks like a MongoDB ObjectId (24 hex chars), look it up
      if (/^[0-9a-f]{24}$/i.test(messageId)) {
        const email = await GmailMessagesCollection.findOneAsync({ _id: messageId });
        if (!email?.id) {
          throw new Error(`Email not found with _id: ${messageId}`);
        }
        gmailMessageId = email.id;
      }

      // Add label via Gmail API
      await Meteor.callAsync('gmail.addLabel', gmailMessageId, labelId);

      // Update local DB to keep it in sync
      await GmailMessagesCollection.updateAsync(
        { id: gmailMessageId },
        { $addToSet: { labelIds: labelId } }
      );

      return buildSuccessResponse({
        success: true,
        messageId: gmailMessageId,
        labelId,
        action: 'added'
      }, 'tool_emailsAddLabel', { source: 'gmail', policy: 'write' });
    } catch (error) {
      console.error('[tool_emailsAddLabel] Error:', error);
      throw new Error(`Failed to add label to email: ${error.message}`);
    }
  },

  async tool_emailsRemoveLabel(args, memory) {
    const { messageId, labelId } = args;

    if (!messageId) throw new Error('messageId is required');
    if (!labelId) throw new Error('labelId is required');

    try {
      // messageId might be MongoDB _id or Gmail id - need to resolve to Gmail id
      const { GmailMessagesCollection } = await import('/imports/api/emails/collections');
      let gmailMessageId = messageId;

      // If it looks like a MongoDB ObjectId (24 hex chars), look it up
      if (/^[0-9a-f]{24}$/i.test(messageId)) {
        const email = await GmailMessagesCollection.findOneAsync({ _id: messageId });
        if (!email?.id) {
          throw new Error(`Email not found with _id: ${messageId}`);
        }
        gmailMessageId = email.id;
      }

      // Remove label via Gmail API
      await Meteor.callAsync('gmail.removeLabel', gmailMessageId, labelId);

      // Update local DB to keep it in sync
      await GmailMessagesCollection.updateAsync(
        { id: gmailMessageId },
        { $pull: { labelIds: labelId } }
      );

      return buildSuccessResponse({
        success: true,
        messageId: gmailMessageId,
        labelId,
        action: 'removed'
      }, 'tool_emailsRemoveLabel', { source: 'gmail', policy: 'write' });
    } catch (error) {
      console.error('[tool_emailsRemoveLabel] Error:', error);
      throw new Error(`Failed to remove label from email: ${error.message}`);
    }
  },

  async tool_emailsCreateLabel(args, memory) {
    const { labelName } = args;

    if (!labelName) throw new Error('labelName is required');

    try {
      const result = await Meteor.callAsync('gmail.createLabel', labelName);

      if (memory) {
        memory.lastCreatedLabel = result.label;
      }

      return buildSuccessResponse({
        success: result.success,
        label: {
          id: result.label.id,
          name: result.label.name
        },
        alreadyExists: result.alreadyExists,
        message: result.alreadyExists
          ? `Label "${labelName}" already exists with ID: ${result.label.id}`
          : `Label "${labelName}" created successfully with ID: ${result.label.id}`
      }, 'tool_emailsCreateLabel', { source: 'gmail', policy: 'write' });
    } catch (error) {
      console.error('[tool_emailsCreateLabel] Error:', error);
      throw new Error(`Failed to create Gmail label: ${error.message}`);
    }
  },

  /**
   * Sync MCP servers from Claude Desktop config
   * Reads claude_desktop_config.json and imports server configurations
   */
  async tool_mcpServersSync(args, memory) {
    try {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');

      // Determine config path based on OS
      const homeDir = os.homedir();
      let configPath;

      if (process.platform === 'darwin') {
        // macOS
        configPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      } else if (process.platform === 'win32') {
        // Windows
        configPath = path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
      } else {
        // Linux
        configPath = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
      }

      // Check if file exists
      try {
        await fs.access(configPath);
      } catch (error) {
        return buildErrorResponse(
          `Claude Desktop config not found at: ${configPath}`,
          'tool_mcpServersSync',
          { source: 'filesystem', policy: 'read_only' }
        );
      }

      // Read and parse config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        return buildErrorResponse(
          'No MCP servers found in Claude Desktop config',
          'tool_mcpServersSync',
          { source: 'filesystem', policy: 'read_only' }
        );
      }

      const { MCPServersCollection } = await import('/imports/api/mcpServers/collections');

      const results = {
        imported: [],
        skipped: [],
        errors: []
      };

      // Import each server
      for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
        try {
          // Check if server already exists
          const existing = await MCPServersCollection.findOneAsync({ name: serverName });
          if (existing) {
            results.skipped.push({
              name: serverName,
              reason: 'Already exists'
            });
            continue;
          }

          // Determine server type (stdio or http)
          let type, serverDoc;

          if (serverConfig.command) {
            // stdio type
            type = 'stdio';
            serverDoc = {
              name: serverName,
              type: 'stdio',
              command: serverConfig.command,
              args: serverConfig.args || [],
              env: serverConfig.env || {},
              enabled: true,
              createdAt: new Date()
            };
          } else if (serverConfig.url) {
            // http type
            type = 'http';
            serverDoc = {
              name: serverName,
              type: 'http',
              url: serverConfig.url,
              headers: serverConfig.headers || {},
              enabled: true,
              createdAt: new Date()
            };
          } else {
            results.errors.push({
              name: serverName,
              reason: 'Unknown server type (no command or url)'
            });
            continue;
          }

          // Insert server
          const serverId = await MCPServersCollection.insertAsync(serverDoc);
          results.imported.push({
            name: serverName,
            type,
            id: serverId
          });

        } catch (error) {
          console.error(`[tool_mcpServersSync] Error importing ${serverName}:`, error);
          results.errors.push({
            name: serverName,
            reason: error.message
          });
        }
      }

      if (memory) {
        memory.lastSync = {
          imported: results.imported.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        };
      }

      return buildSuccessResponse({
        summary: {
          total: results.imported.length + results.skipped.length + results.errors.length,
          imported: results.imported.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors,
        configPath
      }, 'tool_mcpServersSync', { source: 'filesystem', policy: 'write' });

    } catch (error) {
      console.error('[tool_mcpServersSync] Error:', error);
      throw new Error(`Failed to sync MCP servers: ${error.message}`);
    }
  }
};
