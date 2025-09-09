import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getQdrantUrl } from '/imports/api/_shared/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import fetch from 'node-fetch';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { AlarmsCollection } from '/imports/api/alarms/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { ChatsCollection } from '/imports/api/chats/collections';
import { embedText } from '/imports/api/search/vectorStore';
import { buildTasksSelector, buildOverdueSelector, buildByProjectSelector, buildFilterSelector, buildProjectByNameSelector, compileWhere, getListKeyForCollection, FIELD_ALLOWLIST } from '/imports/api/chat/helpers';

const COLLECTION = () => String(Meteor.settings?.qdrantCollectionName || 'panorama');

const buildSystemPrompt = () => {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const nowIso = now.toISOString();
  return [
    "You are Panorama's assistant.",
    'Use the provided CONTEXT when relevant. If the answer is not in the context, answer from general knowledge only if it is safe and obvious; otherwise say you do not know.',
    'You can call tools to retrieve data before answering (e.g., list tasks due before a date).',
    'Never fabricate citations.',
    `Current date/time: ${nowIso} (${tz})`
  ].join(' ');
};

const makeContextBlock = (items) => {
  if (!Array.isArray(items) || items.length === 0) return '(no context)';
  const lines = items.map((it, idx) => {
    const head = `S${idx + 1} [${it.kind}] ${it.title || it.text || it.id}`;
    return `${head}\n${it.text || ''}`.trim();
  });
  return lines.join('\n\n');
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

const embedQuery = async (text) => {
  const { embedText } = await import('/imports/api/search/vectorStore');
  return embedText(text);
};

const safeStringify = (value) => {
  try { return JSON.stringify(value, null, 2); } catch (e) { console.error('[chat.ask] JSON stringify failed', e); return '[unstringifiable]'; }
};

const clampText = (s, max = 300) => {
  const str = String(s || '');
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
};

// Evaluate artifact-based stop conditions (dot-paths, basic wildcards)
const evaluateStopWhen = (have, memory) => {
  if (!Array.isArray(have) || have.length === 0) return false;
  const mem = memory || {};
  const getPath = (obj, path) => {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i += 1) {
      const k = parts[i];
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[k];
    }
    return cur;
  };
  const checkOne = (expr) => {
    const key = String(expr || '').trim();
    if (!key) return false;
    if (key === 'lists.*') {
      const lists = mem.lists || {};
      return Object.values(lists).some((v) => Array.isArray(v) && v.length > 0);
    }
    if (key.startsWith('lists.')) {
      const arr = getPath(mem, key);
      return Array.isArray(arr) && arr.length > 0;
    }
    if (key === 'entities.*') {
      const ents = mem.entities || {};
      return Object.values(ents).some((v) => !!v);
    }
    if (key.startsWith('entities.')) {
      return !!getPath(mem, key);
    }
    if (key === 'ids.*') {
      const ids = mem.ids || {};
      return Object.values(ids).some((v) => !!v);
    }
    if (key.startsWith('ids.')) {
      return !!getPath(mem, key);
    }
    // Legacy compat shortcuts
    if (key === 'lists.tasks') return Array.isArray(mem.tasks) && mem.tasks.length > 0;
    if (key === 'ids.projectId') return !!mem.projectId;
    const val = getPath(mem, key);
    if (Array.isArray(val)) return val.length > 0;
    return !!val;
  };
  // All conditions must be satisfied
  return have.every(checkOne);
};

// Dispatch table for tool execution (generic executor)
const TOOL_HANDLERS = {
  async chat_tasks(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildTasksSelector } = await import('/imports/api/chat/helpers');
    const normArgs = { ...(args || {}) };
    if (!normArgs.dueBefore) normArgs.dueBefore = computeTomorrowEndOfDayISO();
    if (normArgs.status) delete normArgs.status;
    const selector = buildTasksSelector(normArgs);
    if (!('status' in selector)) selector.status = { $ne: 'done' };
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory) {
      memory.tasks = tasks || [];
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
  },
  async chat_overdue(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildOverdueSelector } = await import('/imports/api/chat/helpers');
    const nowIso = (args && typeof args.now === 'string' && args.now.trim()) ? args.now : new Date().toISOString();
    const selector = buildOverdueSelector(nowIso);
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory) {
      memory.tasks = tasks || [];
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
  },
  async chat_tasksByProject(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildByProjectSelector } = await import('/imports/api/chat/helpers');
    const selector = buildByProjectSelector(args && args.projectId);
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    if (memory && Array.isArray(tasks)) {
      memory.tasks = tasks;
      memory.lists = memory.lists || {};
      memory.lists.tasks = (tasks || []).map(t => ({ title: clampText(t.title || ''), projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    }
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
  },
  async chat_tasksFilter(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildFilterSelector } = await import('/imports/api/chat/helpers');
    const selector = buildFilterSelector(args || {});
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory) {
      memory.tasks = tasks || [];
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
  },
  async chat_projectsList(args, memory) {
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
    const compact = (projects || []).map(p => ({ name: clampText(p.name || ''), description: clampText(p.description || '') }));
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.projects = compact;
    }
    return { output: JSON.stringify({ projects: compact, total: compact.length }) };
  },
  async chat_projectByName(args, memory) {
    const { ProjectsCollection } = await import('/imports/api/projects/collections');
    const selector = buildProjectByNameSelector(args && args.name);
    const proj = await ProjectsCollection.findOneAsync(selector, { fields: { name: 1, description: 1 } });
    if (proj && proj._id && memory) {
      memory.projectId = proj._id; // legacy
      memory.projectName = proj.name || null; // legacy
      memory.ids = memory.ids || {};
      memory.ids.projectId = proj._id;
      memory.entities = memory.entities || {};
      memory.entities.project = { name: proj.name || '', description: proj.description || '' };
    }
    const out = proj ? { name: clampText(proj.name || ''), description: clampText(proj.description || '') } : null;
    return { output: JSON.stringify({ project: out }) };
  },
  async chat_semanticSearch(args, memory) {
    const limit = Math.max(1, Math.min(50, Number(args && args.limit) || 8));
    const q = String(args && args.query || '').trim();
    const url = getQdrantUrl();
    const client = new QdrantClient({ url });
    const vector = await embedQuery(q);
    const searchRes = await client.search(COLLECTION(), { vector, limit, with_payload: true });
    const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
    const out = [];
    for (let i = 0; i < items.length; i += 1) {
      const p = items[i]?.payload || {};
      const prev = await fetchPreview(p.kind, p.docId);
      out.push({ kind: p.kind, id: p.docId, title: prev.title, url: prev.url || null, score: items[i]?.score || 0 });
    }
    try {
      const topScores = out.slice(0, 2).map(r => Number(r.score) || 0);
      console.log('[chat.ask][chat_semanticSearch] meta:', { query: clampText(q, 120), limit, total: out.length, topScores });
    } catch (_e) { /* noop */ }
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.searchResults = out;
    }
    return { output: JSON.stringify({ results: out, total: out.length }) };
  }
  ,
  async chat_collectionQuery(args, memory) {
    const collection = String(args && args.collection || '').trim();
    const where = args && args.where ? args.where : {};
    const select = Array.isArray(args && args.select) ? args.select.filter(f => FIELD_ALLOWLIST[collection]?.includes(f)) : [];
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
    } else {
      throw new Error('Unsupported collection');
    }
    const fields = select.length > 0 ? Object.fromEntries(select.map(f => [f, 1])) : undefined;
    const limit = Math.min(200, Math.max(1, Number(args && args.limit) || 50));
    const docs = await cursor.find(selector, { fields }).limit(limit).fetchAsync();
    const key = getListKeyForCollection(collection);
    const list = Array.isArray(docs) ? docs : [];
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists[key] = list;
    }
    return { output: JSON.stringify({ [key]: list, total: list.length }) };
  }
  ,
  async chat_notesByProject(args, memory) {
    const { NotesCollection } = await import('/imports/api/notes/collections');
    const projectId = String(args && args.projectId || '').trim();
    const notes = await NotesCollection.find({ projectId }, { fields: { title: 1 } }).fetchAsync();
    const mapped = (notes || []).map(n => ({ title: clampText(n.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.notes = mapped; }
    return { output: JSON.stringify({ notes: mapped, total: mapped.length }) };
  }
  ,
  async chat_noteSessionsByProject(args, memory) {
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const projectId = String(args && args.projectId || '').trim();
    const sessions = await NoteSessionsCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (sessions || []).map(s => ({ name: clampText(s.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteSessions = mapped; }
    return { output: JSON.stringify({ sessions: mapped, total: mapped.length }) };
  }
  ,
  async chat_noteLinesBySession(args, memory) {
    const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
    const sessionId = String(args && args.sessionId || '').trim();
    const lines = await NoteLinesCollection.find({ sessionId }, { fields: { content: 1 } }).fetchAsync();
    const mapped = (lines || []).map(l => ({ content: clampText(l.content || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteLines = mapped; }
    return { output: JSON.stringify({ lines: mapped, total: mapped.length }) };
  }
  ,
  async chat_linksByProject(args, memory) {
    const { LinksCollection } = await import('/imports/api/links/collections');
    const projectId = String(args && args.projectId || '').trim();
    const links = await LinksCollection.find({ projectId }, { fields: { name: 1, url: 1 } }).fetchAsync();
    const mapped = (links || []).map(l => ({ name: clampText(l.name || ''), url: l.url || null }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.links = mapped; }
    return { output: JSON.stringify({ links: mapped, total: mapped.length }) };
  }
  ,
  async chat_peopleList(args, memory) {
    const { PeopleCollection } = await import('/imports/api/people/collections');
    const people = await PeopleCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (people || []).map(p => ({ name: clampText(p.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.people = mapped; }
    return { output: JSON.stringify({ people: mapped, total: mapped.length }) };
  }
  ,
  async chat_teamsList(args, memory) {
    const { TeamsCollection } = await import('/imports/api/teams/collections');
    const teams = await TeamsCollection.find({}, { fields: { name: 1 } }).fetchAsync();
    const mapped = (teams || []).map(t => ({ name: clampText(t.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.teams = mapped; }
    return { output: JSON.stringify({ teams: mapped, total: mapped.length }) };
  }
  ,
  async chat_filesByProject(args, memory) {
    const { FilesCollection } = await import('/imports/api/files/collections');
    const projectId = String(args && args.projectId || '').trim();
    const files = await FilesCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (files || []).map(f => ({ name: clampText(f.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.files = mapped; }
    return { output: JSON.stringify({ files: mapped, total: mapped.length }) };
  }
  ,
  async chat_alarmsList(args, memory) {
    const { AlarmsCollection } = await import('/imports/api/alarms/collections');
    const enabled = (typeof (args && args.enabled) === 'boolean') ? args.enabled : undefined;
    const sel = (typeof enabled === 'boolean') ? { enabled } : {};
    const alarms = await AlarmsCollection.find(sel, { fields: { title: 1 } }).fetchAsync();
    const mapped = (alarms || []).map(a => ({ title: clampText(a.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.alarms = mapped; }
    return { output: JSON.stringify({ alarms: mapped, total: mapped.length }) };
  }
};

const runTool = async (toolName, args, memory) => {
  const fn = TOOL_HANDLERS[toolName];
  if (!fn) throw new Error(`Unknown tool: ${toolName}`);
  return fn(args, memory);
};

const computeTomorrowEndOfDayISO = () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const end = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999);
  return end.toISOString();
};

// Planner execution toggle: when true, execute the LLM-planned steps before synthesis
const EXECUTE_PLANNER_STEPS = true;

// Build a clearer, human-readable plan based on the user query + planned steps
const buildReadablePlan = (rawQuery, plannedSteps) => {
  const lines = [];
  if (Array.isArray(plannedSteps) && plannedSteps.length > 0) {
    for (let i = 0; i < plannedSteps.length; i += 1) {
      const s = plannedSteps[i] || {};
      lines.push(String(s.tool || 'tool'));
    }
  }
  if (lines.length === 0) return '';
  return ['Plan:', ...lines.map((t, idx) => `${idx + 1}. ${t}`)].join('\n');
};

const fmtYmd = (iso) => {
  const s = String(iso || '');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

const labelForToolStep = (tool, args = {}) => {
  const t = String(tool || '');
  return t || 'step';
};


Meteor.methods({
  async 'chat.ask'(payload) {
    const query = String(payload?.query || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (!query) throw new Meteor.Error('bad-request', 'query is required');

    // Semantic search (RAG) disabled before planner to reduce tokens during tests.
    // This will be reintroduced as a first-class tool the planner can call when needed.
    const sources = [];

    const system = buildSystemPrompt();
    const contextBlock = makeContextBlock(sources.map(s => ({ kind: s.kind, title: s.title, text: s.text, id: s.id })));
    const historyBlock = (history || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const user = [
      `User question: ${query}`,
      '',
      'CONTEXT:',
      contextBlock,
      '',
      (historyBlock ? `History:\n${historyBlock}` : '')
    ].filter(Boolean).join('\n');

    // Log outbound payload (no PII beyond user text)
    console.log('[chat.ask] System:', system);
    console.log('[chat.ask] User:', user);

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');
    // Mini planner: analyze intent → JSON plan (≤5 steps)
    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning…', isStatus: true, createdAt: new Date() });
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
              tool: { type: 'string', enum: ['chat_tasks', 'chat_overdue', 'chat_tasksByProject', 'chat_tasksFilter', 'chat_projectsList', 'chat_projectByName', 'chat_notesByProject', 'chat_noteSessionsByProject', 'chat_noteLinesBySession', 'chat_linksByProject', 'chat_peopleList', 'chat_teamsList', 'chat_filesByProject', 'chat_alarmsList'] },
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
                  enabled: { type: 'boolean' }
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
      'Optionally include stopWhen.have to declare completion artifacts (e.g., lists.tasks, ids.projectId).',
      'Output JSON only that matches the schema. Keep at most 5 steps.'
    ].join(' ');
    const plannerMessages = [
      { role: 'system', content: `${buildSystemPrompt()} Allowed tools: chat_tasks, chat_overdue, chat_tasksByProject, chat_tasksFilter, chat_projectsList, chat_projectByName, chat_notesByProject, chat_noteSessionsByProject, chat_noteLinesBySession, chat_linksByProject, chat_peopleList, chat_teamsList, chat_filesByProject, chat_alarmsList. ${plannerPrompt}` },
      { role: 'user', content: user }
    ];
    const plannerResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'o4-mini',
        messages: plannerMessages,
        response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: false, schema: plannerSchema } }
      })
    });
    let planned = null;
    let stopArtifacts = [];
    if (plannerResp.ok) {
      const pdata = await plannerResp.json();
      const ptext = pdata?.choices?.[0]?.message?.content || '';
      try {
        planned = JSON.parse(ptext);
        console.log('[chat.ask][planner] plan:', safeStringify(planned));
        try {
          const steps = Array.isArray(planned?.steps) ? planned.steps : [];
          const hasExplicit = steps && steps.length > 0;
          stopArtifacts = Array.isArray(planned?.stopWhen?.have) ? planned.stopWhen.have : [];
          let human = buildReadablePlan(query, steps);
          if (hasExplicit) {
            const lines = steps.map((s, idx) => `${idx + 1}. ${labelForToolStep(s.tool, s.args)}`);
            human = ['Plan:', ...lines].join('\n');
          }
          if (human) {
          await ChatsCollection.insertAsync({ role: 'assistant', content: human, isStatus: true, createdAt: new Date() });
          }
        } catch (ePlan) { console.error('[chat.ask] persist plan failed', ePlan); }
      } catch (e) {
        console.error('[chat.ask][planner] parse failed', e);
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planner error: invalid JSON plan from OpenAI. Falling back to auto tools.', error: true, createdAt: new Date() });
        planned = null;
      }
    } else {
      const errText = await plannerResp.text();
      console.error('[chat.ask][planner] OpenAI failed', { status: plannerResp.status, statusText: plannerResp.statusText, body: errText });
      await ChatsCollection.insertAsync({ role: 'assistant', content: `Planner error (${plannerResp.status}): temporarily unavailable. Falling back to auto tools.`, error: true, createdAt: new Date() });
    }
    // If planner produced steps, execute them then synthesize; else fallback to auto tools
    const execSteps = (EXECUTE_PLANNER_STEPS && planned && Array.isArray(planned.steps) && planned.steps.length > 0) ? planned.steps : [];
    if (execSteps && execSteps.length > 0) {
      await ChatsCollection.insertAsync({ role: 'assistant', content: 'Executing plan…', isStatus: true, createdAt: new Date() });
      const toolResults = [];
      // Simple per-request working memory to support chaining between steps
      const memory = { projectId: null, projectName: null, tasks: [] };
      const bindArgs = (toolName, rawArgs) => {
        const a = { ...(rawArgs || {}) };
        if (toolName === 'chat_tasksByProject') {
          if ((!a.projectId || String(a.projectId).trim() === '') && memory.projectId) {
            a.projectId = memory.projectId;
          }
        }
        return a;
      };
      // Early stop based on declared artifacts before executing steps
      if (evaluateStopWhen(stopArtifacts, memory)) {
        // Nothing to do; synthesize empty response promptly
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'No data to retrieve.', isStatus: true, createdAt: new Date() });
        const citations = [];
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Done.', citations, createdAt: new Date() });
        return { text: 'Done.', citations };
      }
      const MAX_STEPS = 5;
      const REQUIRED_ARGS = {
        chat_tasksByProject: ['projectId'],
        chat_projectByName: ['name']
      };
      let replanned = false;
      for (let i = 0; i < Math.min(execSteps.length, MAX_STEPS); i += 1) {
        const step = execSteps[i] || {};
        const tool = String(step.tool || '');
        const args = bindArgs(tool, step.args || {});
        // Minimal generic missing-arg check for known required args
        const required = REQUIRED_ARGS[tool] || [];
        const missing = required.filter((k) => {
          const v = args && args[k];
          return (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
        });
        if (missing.length > 0 && !replanned) {
          // Re-plan once with memory snapshot
          await ChatsCollection.insertAsync({ role: 'assistant', content: 'Re-planning…', isStatus: true, createdAt: new Date() });
          const mem = {
            projectId: memory.projectId || null,
            projectName: memory.projectName || null,
            tasksCount: Array.isArray(memory.tasks) ? memory.tasks.length : 0,
            lastTool: tool,
            missingArgs: missing
          };
          const replanMessages = [
            { role: 'system', content: `${buildSystemPrompt()} Allowed tools: chat_tasks, chat_overdue, chat_tasksByProject, chat_tasksFilter, chat_projectsList, chat_projectByName. ${plannerPrompt}` },
            { role: 'user', content: user + '\n\nMemory snapshot:\n' + safeStringify(mem) }
          ];
          const respRe = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: 'o4-mini', messages: replanMessages, response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: false, schema: plannerSchema } } })
          });
          if (respRe.ok) {
            const pdata2 = await respRe.json();
            const ptext2 = pdata2?.choices?.[0]?.message?.content || '';
            try {
              const planned2 = JSON.parse(ptext2);
              const steps2 = Array.isArray(planned2?.steps) ? planned2.steps : [];
              // Execute the re-planned steps with remaining budget
              const remain = Math.max(0, MAX_STEPS - i);
              for (let j = 0; j < Math.min(steps2.length, remain); j += 1) {
                const step2 = steps2[j] || {};
                const tool2 = String(step2.tool || '');
                const args2 = bindArgs(tool2, step2.args || {});
                if (tool2 === 'chat_tasks') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasks…', isStatus: true, createdAt: new Date() });
                    const { TasksCollection } = await import('/imports/api/tasks/collections');
                    const { buildTasksSelector } = await import('/imports/api/chat/helpers');
                    const normArgs = { ...args2 };
                    if (!normArgs.dueBefore) normArgs.dueBefore = computeTomorrowEndOfDayISO();
                    if (normArgs.status) delete normArgs.status;
                    const selector = buildTasksSelector(normArgs);
                    if (!('status' in selector)) selector.status = { $ne: 'done' };
                    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
                    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_tasks] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                } else if (tool2 === 'chat_overdue') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_overdue…', isStatus: true, createdAt: new Date() });
                    const { TasksCollection } = await import('/imports/api/tasks/collections');
                    const { buildOverdueSelector } = await import('/imports/api/chat/helpers');
                    const nowIso = (args2 && typeof args2.now === 'string' && args2.now.trim()) ? args2.now : new Date().toISOString();
                    const selector = buildOverdueSelector(nowIso);
                    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
                    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_overdue] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                } else if (tool2 === 'chat_tasksByProject') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasksByProject…', isStatus: true, createdAt: new Date() });
                    const { TasksCollection } = await import('/imports/api/tasks/collections');
                    const { buildByProjectSelector } = await import('/imports/api/chat/helpers');
                    const selector = buildByProjectSelector(args2 && args2.projectId);
                    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
                    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
                    memory.tasks = tasks;
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_tasksByProject] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                } else if (tool2 === 'chat_tasksFilter') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasksFilter…', isStatus: true, createdAt: new Date() });
                    const { TasksCollection } = await import('/imports/api/tasks/collections');
                    const { buildFilterSelector } = await import('/imports/api/chat/helpers');
                    const selector = buildFilterSelector(args2 || {});
                    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
                    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_tasksFilter] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                } else if (tool2 === 'chat_projectsList') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_projectsList…', isStatus: true, createdAt: new Date() });
                    const { ProjectsCollection } = await import('/imports/api/projects/collections');
                    const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
                    const compact = (projects || []).map(p => ({ id: p._id, name: p.name || '', description: p.description || '' }));
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ projects: compact }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_projectsList] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                } else if (tool2 === 'chat_projectByName') {
                  try {
                    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_projectByName…', isStatus: true, createdAt: new Date() });
                    const { ProjectsCollection } = await import('/imports/api/projects/collections');
                    const selector = buildProjectByNameSelector(args2 && args2.name);
                    const proj = await ProjectsCollection.findOneAsync(selector, { fields: { name: 1, description: 1 } });
                    if (proj && proj._id) {
                      memory.projectId = proj._id;
                      memory.projectName = proj.name || null;
                    }
                    const out = proj ? { id: proj._id, name: proj.name || '', description: proj.description || '' } : null;
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ project: out }) });
                  } catch (e) {
                    console.error('[chat.ask][replan][chat_projectByName] exec failed', e);
                    toolResults.push({ tool_call_id: `call_re_${j+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
                  }
                }
              }
            } catch (e) {
              console.error('[chat.ask][replan] parse failed', e);
            }
          } else {
            const errTextRe = await respRe.text();
            console.error('[chat.ask][replan] OpenAI failed', { status: respRe.status, statusText: respRe.statusText, body: errTextRe });
          }
          replanned = true;
          break;
        }
        try {
          await ChatsCollection.insertAsync({ role: 'assistant', content: `Running tool: ${tool}…`, isStatus: true, createdAt: new Date() });
          const res = await runTool(tool, args, memory);
          const outStr = res.output || '{}';
          toolResults.push({ tool_call_id: `call_${i+1}`, output: outStr });
          try {
            const parsed = JSON.parse(outStr);
            const keys = Object.keys(parsed || {});
            const total = typeof parsed.total === 'number' ? parsed.total : undefined;
            console.log('[chat.ask][planner][tool output]', { tool, keys, total, length: outStr.length });
          } catch (eLog) {
            console.error('[chat.ask][planner][tool output] parse failed', { tool, length: outStr.length });
          }
        } catch (e) {
          console.error(`[chat.ask][planner][${tool}] exec failed`, e);
          toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
        }
        // Generic early stop removed in favor of declarative stopWhen (future). Keep only MAX_STEPS cap.
      }
      // Synthesis via Chat Completions using only tool results
      await ChatsCollection.insertAsync({ role: 'assistant', content: 'Synthesizing…', isStatus: true, createdAt: new Date() });
      const assistantToolCallMsg = { role: 'assistant', tool_calls: toolResults.map((tr, idx) => ({ id: `call_${idx+1}`, type: 'function', function: { name: execSteps[idx]?.tool || 'chat_tasks', arguments: JSON.stringify(execSteps[idx]?.args || {}) } })) };
      const toolMsgs = toolResults.map(tr => ({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.output }));
      const synthSys = "You are Panorama's assistant. Compose the final answer using ONLY the tool results. Include all items and the total count. Be concise. Do NOT show internal IDs (task or project). Show only human-readable fields (title, status, deadline).";
      const synthUser = 'Summarize the tasks found without showing any internal IDs.';
      const cmplMessages = [ { role: 'system', content: synthSys }, { role: 'user', content: synthUser }, assistantToolCallMsg, ...toolMsgs ];
      const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'o4-mini', messages: cmplMessages })
      });
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        console.error('[chat.ask][planner] final synthesis failed', { status: resp2.status, statusText: resp2.statusText, body: errText2 });
        throw new Meteor.Error('openai-failed', errText2);
      }
      const data2 = await resp2.json();
      let text = data2?.choices?.[0]?.message?.content || '';
      try {
        console.log('[chat.ask][planner] Output length:', (text || '').length);
        console.log('[chat.ask][planner] Output:', text);
      } catch (e) { console.error('[chat.ask][planner] log failed', e); }
      const citations = sources.map(s => ({ id: s.id, title: s.title, kind: s.kind, projectId: s.projectId, sessionId: s.sessionId, url: s.url || null }));
      // The client already persisted the user message for correct ordering; persist only assistant.
      await ChatsCollection.insertAsync({ role: 'assistant', content: text, citations, createdAt: new Date() });
      return { text, citations };
    }
    // Declare available tools for the model (fallback path)
    const tools = [
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
      }
      ,
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
    const firstPayload = {
      model: 'o4-mini',
      instructions: system,
      input: [ { role: 'user', content: [ { type: 'input_text', text: user } ] } ],
      tools,
      tool_choice: 'auto'
    };
    console.log('[chat.ask] First payload.tools:', safeStringify(tools));
    console.log('[chat.ask] First payload.input.length:', firstPayload.input && firstPayload.input.length);
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(firstPayload)
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[chat.ask] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }
    const data = await resp.json();
    const dbg = { keys: Object.keys(data || {}), outputLen: Array.isArray(data?.output) ? data.output.length : 0, tool_calls: data?.tool_calls };
    console.log('[chat.ask] First response meta:', safeStringify(dbg));
    if (Array.isArray(data?.output)) {
      console.log('[chat.ask] First response output types:', data.output.map(x => x && x.type));
    }
    const outputArray = Array.isArray(data?.output) ? data.output : [];
    // Extract tool calls (Responses API emits 'function_call' items in output[])
    const toolCallsFromOutput = outputArray
      .filter((it) => it && (it.type === 'tool_call' || it.type === 'function_call'))
      .map((tc) => {
        console.log('[chat.ask] Raw tool item:', safeStringify(tc));
        const argsStr = (typeof tc?.arguments === 'string') ? tc.arguments : (tc?.function?.arguments || '');
        let argsObj = {};
        try { if (argsStr) argsObj = JSON.parse(argsStr); } catch (e) { console.error('[chat.ask] Failed to parse tool arguments', e); argsObj = {}; }
        return {
          id: tc?.id || tc?.tool_call_id || tc?.call_id || '',
          name: tc?.name || tc?.tool_name || tc?.function?.name || '',
          arguments: argsObj
        };
      });
    const toolCallsTop = Array.isArray(data?.tool_calls) ? data.tool_calls.map((tc) => ({
      id: tc?.id || tc?.tool_call_id || '',
      name: tc?.function?.name || tc?.name || '',
      arguments: (() => { try { return typeof tc?.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc?.arguments || {}); } catch (_e) { return {}; } })()
    })) : [];
    const toolCallsAll = (toolCallsFromOutput.length > 0 ? toolCallsFromOutput : toolCallsTop);
    const toolCalls = toolCallsAll.slice(0, 5);
    console.log('[chat.ask] Tool calls extracted:', safeStringify(toolCalls));
    let text = data?.output_text || (Array.isArray(outputArray) ? outputArray.map(p => p?.content?.[0]?.text || '').join('') : '') || '';

    if (toolCalls.length > 0) {
      const toolResults = [];
      for (const call of toolCalls) {
        if (call.name === 'chat_tasks') {
          try {
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildTasksSelector } = await import('/imports/api/chat/helpers');
            const args = { ...(call.arguments || {}) };
            // Always normalize to tomorrow end-of-day local to avoid LLM drift
            args.dueBefore = computeTomorrowEndOfDayISO();
            // Ignore status filter to match Panorama UI (todo + doing)
            if (args.status) delete args.status;
            const selector = buildTasksSelector(args);
            if (!('status' in selector)) {
              // Match Panorama UI: exclude completed tasks by default
              selector.status = { $ne: 'done' };
            }
            console.log('[chat.ask][chat_tasks] selector:', JSON.stringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            console.log('[chat.ask][chat_tasks] tasks found:', tasks.length);
            const compact = tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
            toolResults.push({ tool_call_id: call.id || 'chat_tasks', output: JSON.stringify({ tasks: compact }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasks', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasks] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_overdue') {
          try {
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildOverdueSelector } = await import('/imports/api/chat/helpers');
            const nowIso = (call.arguments && typeof call.arguments.now === 'string' && call.arguments.now.trim()) ? call.arguments.now : new Date().toISOString();
            const selector = buildOverdueSelector(nowIso);
            console.log('[chat.ask][chat_overdue] selector:', JSON.stringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            const compact = tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
            toolResults.push({ tool_call_id: call.id || 'chat_overdue', output: JSON.stringify({ tasks: compact }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_overdue', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_overdue] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_tasksByProject') {
          try {
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildByProjectSelector } = await import('/imports/api/chat/helpers');
            const selector = buildByProjectSelector(call.arguments && call.arguments.projectId);
            console.log('[chat.ask][chat_tasksByProject] selector:', JSON.stringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            const compact = tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
            toolResults.push({ tool_call_id: call.id || 'chat_tasksByProject', output: JSON.stringify({ tasks: compact }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasksByProject', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasksByProject] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_tasksFilter') {
          try {
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildFilterSelector } = await import('/imports/api/chat/helpers');
            const selector = buildFilterSelector(call.arguments || {});
            console.log('[chat.ask][chat_tasksFilter] selector:', JSON.stringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            const compact = tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
            toolResults.push({ tool_call_id: call.id || 'chat_tasksFilter', output: JSON.stringify({ tasks: compact }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasksFilter', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasksFilter] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_projectsList') {
          try {
            const { ProjectsCollection } = await import('/imports/api/projects/collections');
            const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
            const compact = (projects || []).map(p => ({ id: p._id, name: p.name || '', description: p.description || '' }));
            toolResults.push({ tool_call_id: call.id || 'chat_projectsList', output: JSON.stringify({ projects: compact }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_projectsList', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_projectsList] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_projectByName') {
          try {
            const { ProjectsCollection } = await import('/imports/api/projects/collections');
            const selector = buildProjectByNameSelector(call.arguments && call.arguments.name);
            const proj = await ProjectsCollection.findOneAsync(selector, { fields: { name: 1, description: 1 } });
            const out = proj ? { id: proj._id, name: proj.name || '', description: proj.description || '' } : null;
            toolResults.push({ tool_call_id: call.id || 'chat_projectByName', output: JSON.stringify({ project: out }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_projectByName', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_projectByName] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_semanticSearch') {
          try {
            const limit = Math.max(1, Math.min(50, Number(call.arguments && call.arguments.limit) || 8));
            const q = String(call.arguments && call.arguments.query || '').trim();
            const url = getQdrantUrl();
            const client = new QdrantClient({ url });
            const vector = await embedQuery(q);
            const searchRes = await client.search(COLLECTION(), { vector, limit, with_payload: true });
            const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
            const out = [];
            for (let i = 0; i < items.length; i += 1) {
              const p = items[i]?.payload || {};
              const prev = await fetchPreview(p.kind, p.docId);
              out.push({ kind: p.kind, id: p.docId, title: prev.title, url: prev.url || null, score: items[i]?.score || 0 });
            }
            try {
              const topScores = out.slice(0, 2).map(r => Number(r.score) || 0);
              console.log('[chat.ask][chat_semanticSearch] meta:', {
                query: clampText(q, 120),
                limit,
                total: out.length,
                topScores
              });
            } catch (_e) { /* noop */ }
            toolResults.push({ tool_call_id: call.id || 'chat_semanticSearch', output: JSON.stringify({ results: out, total: out.length }) });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_semanticSearch', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_semanticSearch] execution error:', e?.message || e);
          }
        }
      }
      // Final synthesis call via Chat Completions (stable tool result protocol)
      const shortenId = (id) => {
        const s = String(id || 'call_0');
        return s.length > 40 ? s.slice(0, 40) : s;
      };
      const mappedCalls = toolCalls.map(tc => ({
        origId: tc.id || 'call_0',
        id: shortenId(tc.id || 'call_0'),
        name: tc.name,
        args: JSON.stringify(tc.arguments || {})
      }));
      const idMap = new Map(mappedCalls.map(c => [c.origId, c.id]));
      const assistantToolCallMsg = {
        role: 'assistant',
        tool_calls: mappedCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
      };
      const toolMsgs = toolResults.map(tr => ({ role: 'tool', tool_call_id: idMap.get(tr.tool_call_id) || mappedCalls[0]?.id || 'call_0', content: tr.output || '{}' }));
      const synthesisGuidance = 'Use ONLY the tool results; list all returned items with concise human-friendly fields and include total counts where applicable. Do NOT show internal IDs.';
      const cmplMessages = [
        { role: 'system', content: system + ' ' + synthesisGuidance },
        { role: 'user', content: user },
        assistantToolCallMsg,
        ...toolMsgs
      ];
      console.log('[chat.ask] ChatCompletions second-call messages:', safeStringify(cmplMessages));
      const resp2 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'o4-mini', messages: cmplMessages })
      });
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        console.error('[chat.ask] OpenAI final synthesis failed', { status: resp2.status, statusText: resp2.statusText, body: errText2 });
        throw new Meteor.Error('openai-failed', errText2);
      }
      const data2 = await resp2.json();
      text = data2?.choices?.[0]?.message?.content || '';
    }
    try {
      console.log('[chat.ask] Output length:', (text || '').length);
      console.log('[chat.ask] Output:', text);
    } catch (_e) { /* noop */ }
    const citations = sources.map(s => ({ id: s.id, title: s.title, kind: s.kind, projectId: s.projectId, sessionId: s.sessionId, url: s.url || null }));

    // Persist only assistant: client already persisted the user message for proper ordering
    await ChatsCollection.insertAsync({ role: 'assistant', content: text, citations, createdAt: new Date() });
    return { text, citations };
  },
  async 'chat.tasks'(search = {}) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const selector = {};
    if (search && typeof search.projectId === 'string' && search.projectId.trim()) selector.projectId = search.projectId.trim();
    if (search && typeof search.status === 'string' && search.status.trim()) selector.status = search.status.trim();
    if (search && typeof search.dueBefore === 'string' && search.dueBefore.trim()) {
      const dt = new Date(search.dueBefore);
      if (!isNaN(dt.getTime())) selector.deadline = { $lte: dt.toISOString().slice(0, 10) };
    }
    const tasks = await TasksCollection.find(selector, { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } }).fetchAsync();
    return tasks.map(t => ({ _id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
  },
  async 'chat.overdue'(params = {}) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildOverdueSelector } = await import('/imports/api/chat/helpers');
    const nowIso = (params && typeof params.now === 'string' && params.now.trim()) ? params.now : new Date().toISOString();
    const selector = buildOverdueSelector(nowIso);
    const tasks = await TasksCollection.find(selector, { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } }).fetchAsync();
    return tasks.map(t => ({ _id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
  },
  async 'chat.tasksByProject'(search = {}) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildByProjectSelector } = await import('/imports/api/chat/helpers');
    const selector = buildByProjectSelector(search && search.projectId);
    const tasks = await TasksCollection.find(selector, { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } }).fetchAsync();
    return tasks.map(t => ({ _id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
  },
  async 'chat.tasksFilter'(filters = {}) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildFilterSelector } = await import('/imports/api/chat/helpers');
    const selector = buildFilterSelector(filters || {});
    const tasks = await TasksCollection.find(selector, { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } }).fetchAsync();
    return tasks.map(t => ({ _id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null }));
  }
});
