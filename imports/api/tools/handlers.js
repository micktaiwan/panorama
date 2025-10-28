// Tool handlers - implements all 20 tools
// Shared by Chat and MCP server

import { Meteor } from 'meteor/meteor';
import { getQdrantUrl } from '/imports/api/_shared/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  buildProjectByNameSelector,
  buildByProjectSelector,
  buildFilterSelector,
  compileWhere,
  getListKeyForCollection,
  FIELD_ALLOWLIST
} from '/imports/api/tools/helpers';

// Qdrant collection name
const COLLECTION = () => String(Meteor.settings?.qdrantCollectionName || 'panorama');

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
    return { output: JSON.stringify({ tools, total: tools.length }) };
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
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
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
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
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
    return { output: JSON.stringify({ projects: compact, total: compact.length }) };
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
    return { output: JSON.stringify({ project: out }) };
  },
  async tool_createProject(args, memory) {
    const name = String(args?.name || '').trim();
    if (!name) throw new Error('name is required');

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

    return { output: JSON.stringify(result) };
  },
  async tool_semanticSearch(args, memory) {
    const limit = Math.max(1, Math.min(50, Number(args?.limit) || 8));
    const q = String(args?.query || '').trim();
    const url = getQdrantUrl();
    if (!url) {
      if (memory) { memory.lists = memory.lists || {}; memory.lists.searchResults = []; }
      return { output: JSON.stringify({ results: [], total: 0, disabled: true }) };
    }
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
    return { output: JSON.stringify({ results: out, total: out.length }) };
  },
  async tool_collectionQuery(args, memory) {
    const collection = String(args?.collection || '').trim();
    const where = args?.where ? args.where : {};
    const select = Array.isArray(args?.select) ? args.select.filter(f => FIELD_ALLOWLIST[collection]?.includes(f)) : [];
    const sort = args?.sort || {};
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
    } else {
      throw new Error('Unsupported collection');
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
    return { output: JSON.stringify({ [key]: list, total: list.length }) };
  },
  async tool_notesByProject(args, memory) {
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const projectId = String(args?.projectId || '').trim();
    const notes = await NotesCollection.find({ projectId }, { fields: { title: 1 } }).fetchAsync();
    const mapped = (notes || []).map(n => ({ id: n._id, title: clampText(n.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.notes = mapped; }
    return { output: JSON.stringify({ notes: mapped, total: mapped.length }) };
  },
  async tool_noteById(args, memory) {
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const noteId = String(args?.noteId || '').trim();
    if (!noteId) return { output: JSON.stringify({ note: null, error: 'noteId is required' }) };
    const note = await NotesCollection.findOneAsync(
      { _id: noteId },
      { fields: { title: 1, content: 1, projectId: 1, createdAt: 1, updatedAt: 1 } }
    );
    if (!note) return { output: JSON.stringify({ note: null }) };
    const result = {
      id: note._id,
      title: note.title || '',
      content: note.content || '',
      projectId: note.projectId || null,
      createdAt: note.createdAt ? note.createdAt.toISOString() : null,
      updatedAt: note.updatedAt ? note.updatedAt.toISOString() : null
    };
    if (memory) { memory.entities = memory.entities || {}; memory.entities.note = result; }
    return { output: JSON.stringify({ note: result }) };
  },
  async tool_noteSessionsByProject(args, memory) {
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const projectId = String(args?.projectId || '').trim();
    const sessions = await NoteSessionsCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (sessions || []).map(s => ({ id: s._id, name: clampText(s.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteSessions = mapped; }
    return { output: JSON.stringify({ sessions: mapped, total: mapped.length }) };
  },
  async tool_noteLinesBySession(args, memory) {
    const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
    const sessionId = String(args?.sessionId || '').trim();
    const lines = await NoteLinesCollection.find({ sessionId }, { fields: { content: 1 } }).fetchAsync();
    const mapped = (lines || []).map(l => ({ id: l._id, content: clampText(l.content || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteLines = mapped; }
    return { output: JSON.stringify({ lines: mapped, total: mapped.length }) };
  },
  async tool_linksByProject(args, memory) {
    const { LinksCollection } = await import('/imports/api/links/collections');
    const projectId = String(args?.projectId || '').trim();
    const links = await LinksCollection.find({ projectId }, { fields: { name: 1, url: 1 } }).fetchAsync();
    const mapped = (links || []).map(l => ({ id: l._id, name: clampText(l.name || ''), url: l.url || null }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.links = mapped; }
    return { output: JSON.stringify({ links: mapped, total: mapped.length }) };
  },
  async tool_peopleList(args, memory) {
    const { PeopleCollection } = await import('/imports/api/people/collections');
    const people = await PeopleCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (people || []).map(p => ({ id: p._id, name: clampText(p.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.people = mapped; }
    return { output: JSON.stringify({ people: mapped, total: mapped.length }) };
  },
  async tool_teamsList(args, memory) {
    const { TeamsCollection } = await import('/imports/api/teams/collections');
    const teams = await TeamsCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (teams || []).map(t => ({ id: t._id, name: clampText(t.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.teams = mapped; }
    return { output: JSON.stringify({ teams: mapped, total: mapped.length }) };
  },
  async tool_filesByProject(args, memory) {
    const { FilesCollection } = await import('/imports/api/files/collections');
    const projectId = String(args?.projectId || '').trim();
    const files = await FilesCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (files || []).map(f => ({ id: f._id, name: clampText(f.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.files = mapped; }
    return { output: JSON.stringify({ files: mapped, total: mapped.length }) };
  },
  async tool_alarmsList(args, memory) {
    const { AlarmsCollection } = await import('/imports/api/alarms/collections');
    const enabled = (typeof args?.enabled === 'boolean') ? args.enabled : undefined;
    const sel = (typeof enabled === 'boolean') ? { enabled } : {};
    const alarms = await AlarmsCollection.find(sel, { fields: { title: 1 } }).fetchAsync();
    const mapped = (alarms || []).map(a => ({ id: a._id, title: clampText(a.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.alarms = mapped; }
    return { output: JSON.stringify({ alarms: mapped, total: mapped.length }) };
  },
  async tool_createTask(args, memory) {
    const title = String(args?.title || '').trim();
    if (!title) throw new Error('title is required');

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

    return { output: JSON.stringify(result) };
  },
  async tool_updateTask(args, memory) {
    const taskId = String(args?.taskId || '').trim();
    if (!taskId) throw new Error('taskId is required');

    const modifier = {};

    if (args?.title) modifier.title = String(args.title);
    if (args?.notes !== undefined) modifier.notes = String(args.notes || '');
    if (args?.status) modifier.status = String(args.status);
    if (args?.deadline !== undefined) modifier.deadline = args.deadline ? String(args.deadline) : null;
    if (args?.projectId !== undefined) modifier.projectId = args.projectId ? String(args.projectId).trim() : null;
    if (typeof args?.isUrgent === 'boolean') modifier.isUrgent = args.isUrgent;
    if (typeof args?.isImportant === 'boolean') modifier.isImportant = args.isImportant;

    if (Object.keys(modifier).length === 0) {
      throw new Error('No fields to update');
    }

    await Meteor.callAsync('tasks.update', taskId, modifier);

    const result = { updated: true, taskId };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.taskId = taskId;
    }

    return { output: JSON.stringify(result) };
  },
  async tool_createNote(args, memory) {
    const title = String(args?.title || '').trim();
    if (!title) throw new Error('title is required');

    const doc = { title };

    if (args?.content) doc.content = String(args.content);
    if (args?.projectId) doc.projectId = String(args.projectId).trim();

    const noteId = await Meteor.callAsync('notes.insert', doc);

    const result = { noteId, title, projectId: doc.projectId || null };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.noteId = noteId;
    }

    return { output: JSON.stringify(result) };
  },
  async tool_updateNote(args, memory) {
    const noteId = String(args?.noteId || '').trim();
    if (!noteId) throw new Error('noteId is required');

    const modifier = {};

    if (args?.title) modifier.title = String(args.title);
    if (args?.content !== undefined) modifier.content = String(args.content || '');
    if (args?.projectId !== undefined) modifier.projectId = args.projectId ? String(args.projectId).trim() : null;

    if (Object.keys(modifier).length === 0) {
      throw new Error('No fields to update');
    }

    await Meteor.callAsync('notes.update', noteId, modifier);

    const result = { updated: true, noteId };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.noteId = noteId;
    }

    return { output: JSON.stringify(result) };
  },
  async tool_createLink(args, memory) {
    const name = String(args?.name || '').trim();
    const url = String(args?.url || '').trim();

    if (!name) throw new Error('name is required');
    if (!url) throw new Error('url is required');

    const doc = { name, url };

    if (args?.projectId) doc.projectId = String(args.projectId).trim();

    const linkId = await Meteor.callAsync('links.insert', doc);

    const result = { linkId, name, url, projectId: doc.projectId || null };
    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.linkId = linkId;
    }

    return { output: JSON.stringify(result) };
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

    return { output: JSON.stringify({ userLogs: mapped, total: mapped.length }) };
  }
};
