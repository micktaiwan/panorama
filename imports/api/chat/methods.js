import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getQdrantUrl } from '/imports/api/_shared/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ChatsCollection } from '/imports/api/chats/collections';
import { buildProjectByNameSelector, compileWhere, getListKeyForCollection, FIELD_ALLOWLIST } from '/imports/api/chat/helpers';
import { buildCitationsFromMemory, buildCitationsFromToolResults, buildPlannerConfig, buildResponsesFirstPayload, extractResponsesToolCalls } from '/imports/api/chat/tools_helpers';

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

// evaluateStopWhen is imported from helpers.js - see buildTasksSelector import above

// Dispatch table for tool execution (generic executor)
// Tool schemas with required arguments and metadata
const TOOL_SCHEMAS = {
  chat_tasks: { required: [], readOnly: true },
  chat_overdue: { required: [], readOnly: true },
  chat_tasksByProject: { required: ['projectId'], readOnly: true },
  chat_tasksFilter: { required: [], readOnly: true },
  chat_projectsList: { required: [], readOnly: true },
  chat_projectByName: { required: ['name'], readOnly: true },
  chat_semanticSearch: { required: ['query'], readOnly: true },
  chat_collectionQuery: { required: ['collection'], readOnly: true },
  chat_notesByProject: { required: ['projectId'], readOnly: true },
  chat_noteSessionsByProject: { required: ['projectId'], readOnly: true },
  chat_noteLinesBySession: { required: ['sessionId'], readOnly: true },
  chat_linksByProject: { required: ['projectId'], readOnly: true },
  chat_peopleList: { required: [], readOnly: true },
  chat_teamsList: { required: [], readOnly: true },
  chat_filesByProject: { required: ['projectId'], readOnly: true },
  chat_alarmsList: { required: [], readOnly: true }
};

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
    // Remove internal IDs from UI responses
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
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
    const nowIso = (typeof args?.now === 'string' && args?.now?.trim()) ? args.now : new Date().toISOString();
    const selector = buildOverdueSelector(nowIso);
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    // Remove internal IDs from UI responses
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
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
    const selector = buildByProjectSelector(args?.projectId);
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    // Remove internal IDs from UI responses
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
    if (memory && Array.isArray(tasks)) {
      memory.tasks = tasks;
      memory.lists = memory.lists || {};
      memory.lists.tasks = mapped;
    }
    return { output: JSON.stringify({ tasks: mapped, total: mapped.length }) };
  },
  async chat_tasksFilter(args, memory) {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { buildFilterSelector } = await import('/imports/api/chat/helpers');
    const selector = buildFilterSelector(args || {});
    const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1 } };
    const tasks = await TasksCollection.find(selector, fields).fetchAsync();
    // Remove internal IDs from UI responses
    const mapped = (tasks || []).map(t => ({ title: clampText(t.title || ''), status: t.status || 'todo', deadline: t.deadline || null, isUrgent: !!t.isUrgent, isImportant: !!t.isImportant }));
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
    // Remove internal IDs from UI responses
    const compact = (projects || []).map(p => ({ name: clampText(p.name || ''), description: clampText(p.description || '') }));
    if (memory) {
      memory.lists = memory.lists || {};
      memory.lists.projects = compact;
    }
    return { output: JSON.stringify({ projects: compact, total: compact.length }) };
  },
  async chat_projectByName(args, memory) {
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
    const out = proj ? { name: clampText(proj.name || ''), description: clampText(proj.description || '') } : null;
    return { output: JSON.stringify({ project: out }) };
  },
  async chat_semanticSearch(args, memory) {
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
  }
  ,
  async chat_collectionQuery(args, memory) {
    const collection = String(args?.collection || '').trim();
    const where = args?.where ? args.where : {};
    const select = Array.isArray(args?.select) ? args.select.filter(f => FIELD_ALLOWLIST[collection]?.includes(f)) : [];
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
    const projectId = String(args?.projectId || '').trim();
    const notes = await NotesCollection.find({ projectId }, { fields: { title: 1 } }).fetchAsync();
    const mapped = (notes || []).map(n => ({ title: clampText(n.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.notes = mapped; }
    return { output: JSON.stringify({ notes: mapped, total: mapped.length }) };
  }
  ,
  async chat_noteSessionsByProject(args, memory) {
    const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
    const projectId = String(args?.projectId || '').trim();
    const sessions = await NoteSessionsCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (sessions || []).map(s => ({ name: clampText(s.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteSessions = mapped; }
    return { output: JSON.stringify({ sessions: mapped, total: mapped.length }) };
  }
  ,
  async chat_noteLinesBySession(args, memory) {
    const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
    const sessionId = String(args?.sessionId || '').trim();
    const lines = await NoteLinesCollection.find({ sessionId }, { fields: { content: 1 } }).fetchAsync();
    const mapped = (lines || []).map(l => ({ content: clampText(l.content || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.noteLines = mapped; }
    return { output: JSON.stringify({ lines: mapped, total: mapped.length }) };
  }
  ,
  async chat_linksByProject(args, memory) {
    const { LinksCollection } = await import('/imports/api/links/collections');
    const projectId = String(args?.projectId || '').trim();
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
    const projectId = String(args?.projectId || '').trim();
    const files = await FilesCollection.find({ projectId }, { fields: { name: 1 } }).fetchAsync();
    const mapped = (files || []).map(f => ({ name: clampText(f.name || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.files = mapped; }
    return { output: JSON.stringify({ files: mapped, total: mapped.length }) };
  }
  ,
  async chat_alarmsList(args, memory) {
    const { AlarmsCollection } = await import('/imports/api/alarms/collections');
    const enabled = (typeof args?.enabled === 'boolean') ? args.enabled : undefined;
    const sel = (typeof enabled === 'boolean') ? { enabled } : {};
    const alarms = await AlarmsCollection.find(sel, { fields: { title: 1 } }).fetchAsync();
    const mapped = (alarms || []).map(a => ({ title: clampText(a.title || '') }));
    if (memory) { memory.lists = memory.lists || {}; memory.lists.alarms = mapped; }
    return { output: JSON.stringify({ alarms: mapped, total: mapped.length }) };
  }
};

// Attempt to resolve missing projectId from known project name in args or memory.
// Updates memory with resolved IDs/entities when successful.
const ensureProjectIdArg = async (argsIn, memory) => {
  const args = { ...(argsIn || {}) };
  const existing = String(args.projectId || '').trim();
  if (existing) return args;

  const candidateName = String(
    args?.name ||
    memory?.projectName ||
    memory?.entities?.project?.name ||
    ''
  ).trim();
  if (!candidateName) return args;

  const selector = buildProjectByNameSelector(candidateName);
  const proj = await ProjectsCollection.findOneAsync(selector, { fields: { name: 1, description: 1 } });
  if (proj?._id) {
    args.projectId = proj._id;

    if (memory) {
      memory.ids = memory.ids || {};
      memory.ids.projectId = proj._id;
      memory.entities = memory.entities || {};
      memory.entities.project = { name: proj.name || '', description: proj.description || '' };
      // Legacy
      memory.projectId = proj._id;
      memory.projectName = proj.name || null;
    }
  }
  return args;
};

// Generic step executor with timeout and retry logic
const executeStep = async (step, memory, callId, retries = 3) => {
  const tool = String(step.tool || '');
  const { bindArgsWithMemory } = await import('/imports/api/chat/helpers');
  let args = bindArgsWithMemory(tool, step.args || {}, memory);
  
  // Opportunistically resolve missing projectId from memory/name before enforcing requirements
  const schemaPre = TOOL_SCHEMAS[tool];
  if (schemaPre && Array.isArray(schemaPre.required) && schemaPre.required.includes('projectId')) {
    const needsProjectId = !args || !String(args.projectId || '').trim();
    if (needsProjectId) {
      args = await ensureProjectIdArg(args, memory);
    }
  }
  
  // Check required arguments
  const schema = TOOL_SCHEMAS[tool];
  if (schema) {
    const missing = (schema.required || []).filter(k => {
      const v = args[k];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    if (missing.length > 0) {
      throw new Error(`Missing required arguments for ${tool}: ${missing.join(', ')}`);
    }
  }
  
  // Execute with retry logic
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await runTool(tool, args, memory);
      return {
        tool_call_id: callId || `call_${Date.now()}`,
        output: result.output || '{}',
        tool,
        args
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        console.error(`[executeStep] ${tool} attempt ${attempt + 1} failed, retrying:`, error.message);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000)); // exponential backoff
      }
    }
  }
  
  console.error(`[executeStep] ${tool} failed after ${retries} attempts:`, lastError.message);
  return {
    tool_call_id: callId || `call_${Date.now()}`,
    output: JSON.stringify({ error: lastError?.message || String(lastError) }),
    tool,
    args
  };
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

// Removed verbose planner helpers


Meteor.methods({
  async 'chat.ask'(payload) {
    const query = String(payload?.query || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (!query) throw new Meteor.Error('bad-request', 'query is required');

    // Semantic search available as chat_semanticSearch tool when planner needs it
    const system = buildSystemPrompt();
    const contextBlock = makeContextBlock([]);
    const historyBlock = (history || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const user = [
      `User question: ${query}`,
      '',
      'CONTEXT:',
      contextBlock,
      '',
      (historyBlock ? `History:\n${historyBlock}` : '')
    ].filter(Boolean).join('\n');

    // Verbose outbound payload logs removed

    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
    const { default: fetch } = await import('node-fetch');
    const fetchWithTimeout = async (url, init = {}, ms = 30000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...(init || {}), signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    };
    // Mini planner: analyze intent → JSON plan (≤5 steps)
    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning…', isStatus: true, createdAt: new Date() });
    const { plannerSchema, plannerPrompt, plannerMessages } = buildPlannerConfig(
      buildSystemPrompt(),
      user,
      Object.keys(TOOL_SCHEMAS)
    );
    let plannerResp;
    try {
      plannerResp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'o4-mini',
          messages: plannerMessages,
          response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: false, schema: plannerSchema } }
        })
      }, 30000);
    } catch (plannerError) {
      if (plannerError.name === 'AbortError') {
        console.error('[chat.ask][planner] timeout after 30s');
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning timed out. Falling back to auto tools.', error: true, createdAt: new Date() });
        plannerResp = { ok: false };
      } else {
        throw plannerError;
      }
    }
    let planned = null;
    let stopArtifacts = [];
    if (plannerResp.ok) {
      const pdata = await plannerResp.json();
      const ptext = pdata?.choices?.[0]?.message?.content || '';
      try {
        planned = JSON.parse(ptext);
        stopArtifacts = Array.isArray(planned?.stopWhen) ? planned.stopWhen : [];
      } catch (ePlan) { console.error('[chat.ask] persist plan failed', ePlan); }
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
      // Generic working memory structure
      const memory = { 
        ids: {},
        entities: {},
        lists: {},
        params: {},
        errors: [],
        // Legacy fields for backward compatibility
        projectId: null, projectName: null, tasks: []
      };
      // Early stop based on declared artifacts before executing steps
      const { evaluateStopWhen } = await import('/imports/api/chat/helpers');
      if (evaluateStopWhen(stopArtifacts, memory)) {
        // Nothing to do; synthesize empty response promptly
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'No data to retrieve.', isStatus: true, createdAt: new Date() });
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Done.', createdAt: new Date() });
        return { text: 'Done.', citations: [] };
      }
      const MAX_STEPS = 5;
      for (let i = 0; i < Math.min(execSteps.length, MAX_STEPS); i += 1) {
        const step = execSteps[i] || {};
        
        try {
          // Try to execute the step
          await ChatsCollection.insertAsync({ role: 'assistant', content: `Running tool: ${step.tool}…`, isStatus: true, createdAt: new Date() });
          const result = await executeStep(step, memory, `call_${i+1}`);
          toolResults.push(result);
          
          // Log output metadata removed (keep error on parse)
          try {
            JSON.parse(result.output || '{}');
          } catch {
            console.error('[chat.ask][planner][tool output] parse failed', { tool: step.tool, length: (result.output || '').length });
          }
          
        } catch (stepError) {
          // Handle missing arguments with re-planning
          if (stepError.message.includes('Missing required arguments')) {
            // Re-plan once with memory snapshot
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Re-planning…', isStatus: true, createdAt: new Date() });
            const mem = {
              ids: memory.ids || {},
              entities: memory.entities || {},
              lists: memory.lists || {},
              lastTool: step.tool,
              error: stepError.message,
              // Legacy fields
              projectId: memory.projectId || null,
              projectName: memory.projectName || null,
              tasksCount: Array.isArray(memory.tasks) ? memory.tasks.length : 0
            };
            const replanMessages = [
              { role: 'system', content: `${buildSystemPrompt()} Allowed tools: ${Object.keys(TOOL_SCHEMAS).join(', ')}. ${plannerPrompt}` },
              { role: 'user', content: user + '\n\nMemory snapshot:\n' + safeStringify(mem) }
            ];
            
            try {
              const respRe = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: 'o4-mini', messages: replanMessages, response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: false, schema: plannerSchema } } })
              }, 30000);
              if (respRe.ok) {
                const pdata2 = await respRe.json();
                const ptext2 = pdata2?.choices?.[0]?.message?.content || '';
                try {
                  const planned2 = JSON.parse(ptext2);
                  const steps2 = Array.isArray(planned2?.steps) ? planned2.steps : [];
                  // Note: re-planned stop conditions are not applied, as we break out of the outer loop after re-plan.
                  
                  // Helper to pre-validate and auto-resolve required args (e.g., projectId)
                  const prepareArgsForStep = async (stepIn) => {
                    const { bindArgsWithMemory } = await import('/imports/api/chat/helpers');
                    let prepared = bindArgsWithMemory(stepIn.tool, stepIn.args || {}, memory);
                    const schemaX = TOOL_SCHEMAS[stepIn.tool];
                    if (schemaX && Array.isArray(schemaX.required) && schemaX.required.includes('projectId')) {
                      const needs = !prepared || !String(prepared.projectId || '').trim();
                      if (needs) prepared = await ensureProjectIdArg(prepared, memory);
                    }
                    return prepared;
                  };
                  
                  // Execute the re-planned steps with remaining budget using generic executor
                  const remain = Math.max(0, MAX_STEPS - i);
                  for (let j = 0; j < Math.min(steps2.length, remain); j += 1) {
                    try {
                      const stepJ = steps2[j] || {};
                      const argsJ = await prepareArgsForStep(stepJ);
                      const schemaJ = TOOL_SCHEMAS[stepJ.tool];
                      if (schemaJ && Array.isArray(schemaJ.required) && schemaJ.required.includes('projectId')) {
                        const hasPid = String(argsJ?.projectId || '').trim();
                        if (!hasPid) {
                          // Skip quietly when projectId cannot be resolved, avoiding noisy errors
                          toolResults.push({ 
                            tool_call_id: `call_re_${j+1}`, 
                            output: JSON.stringify({ skipped: true, reason: 'Missing projectId after resolution' }),
                            tool: stepJ.tool,
                            args: argsJ
                          });
                          continue;
                        }
                      }
                      const replanResult = await executeStep({ tool: stepJ.tool, args: argsJ }, memory, `call_re_${j+1}`);
                      toolResults.push(replanResult);
                    } catch (replanError) {
                      console.error('[chat.ask][replan] step failed', replanError);
                      toolResults.push({ 
                        tool_call_id: `call_re_${j+1}`, 
                        output: JSON.stringify({ error: replanError?.message || String(replanError) }) 
                      });
                    }
                  }
                } catch (e) {
                  console.error('[chat.ask][replan] parse failed', e);
                }
              } else {
                const errTextRe = await respRe.text();
                console.error('[chat.ask][replan] OpenAI failed', { status: respRe.status, statusText: respRe.statusText, body: errTextRe });
              }
            } catch (fetchError) {
              if (fetchError.name === 'AbortError') {
                console.error('[chat.ask][replan] timeout after 30s');
              } else {
                console.error('[chat.ask][replan] fetch failed', fetchError);
              }
            }
            break;
          } else {
            // Re-throw non-replannable errors
            console.error(`[chat.ask][planner][${step.tool}] exec failed`, stepError);
            toolResults.push({ 
              tool_call_id: `call_${i+1}`, 
              output: JSON.stringify({ error: stepError?.message || String(stepError) }) 
            });
          }
        }
        
        // Check for early termination based on stopWhen artifacts
        const { evaluateStopWhen } = await import('/imports/api/chat/helpers');
        if (evaluateStopWhen(stopArtifacts, memory)) {
          break;
        }
      }
      
      
      // Synthesis via Chat Completions using only tool results
      await ChatsCollection.insertAsync({ role: 'assistant', content: 'Synthesizing…', isStatus: true, createdAt: new Date() });
      // Filter out skipped tool results so they don't pollute synthesis context
      const parsedResults = toolResults.map(tr => {
        let payload;
        try { payload = JSON.parse(tr.output || '{}'); } catch { payload = {}; }
        return { ...tr, _payload: payload };
      });
      const finalResults = parsedResults.filter(tr => tr._payload && tr._payload.skipped !== true);

      const assistantToolCallMsg = { 
        role: 'assistant', 
        tool_calls: finalResults.map((tr, idx) => ({
          id: tr.tool_call_id || `call_${idx+1}`, 
          type: 'function', 
          function: { 
            name: tr.tool || 'unknown_tool', 
            arguments: JSON.stringify(tr.args || {}) 
          } 
        }))
      };
      const toolMsgs = finalResults.map(tr => ({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.output }));
      const synthSys = "You are Panorama's assistant. Compose the final answer using ONLY the tool results. Include all items and the total count. Be concise. Do NOT show internal IDs (task or project). Show only human-readable fields (title, status, deadline).";
      const synthUser = `Answer the user's question: "${query}" using only the provided tool results.`;
      const cmplMessages = [ { role: 'system', content: synthSys }, { role: 'user', content: synthUser }, assistantToolCallMsg, ...toolMsgs ];
      
      let resp2;
      try {
        resp2 = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, 
          body: JSON.stringify({ model: 'o4-mini', messages: cmplMessages })
        }, 30000);
      } catch (synthError) {
        if (synthError.name === 'AbortError') {
          throw new Meteor.Error('openai-timeout', 'Synthesis request timed out after 30 seconds');
        }
        throw synthError;
      }
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        console.error('[chat.ask][planner] final synthesis failed', { status: resp2.status, statusText: resp2.statusText, body: errText2 });
        throw new Meteor.Error('openai-failed', `Synthesis failed (${resp2.status}): ${errText2}`);
      }
      const data2 = await resp2.json();
      let text = data2?.choices?.[0]?.message?.content || '';
      const citations = buildCitationsFromMemory(memory);
      const base = { role: 'assistant', content: text, createdAt: new Date() };
      await ChatsCollection.insertAsync(citations.length ? { ...base, citations } : base);
      return { text, citations };
    }
    // Declare available tools for the model (fallback path)
    const firstPayload = buildResponsesFirstPayload(system, user);
    
    const resp = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(firstPayload)
    }, 30000);
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[chat.ask] OpenAI failed', { status: resp.status, statusText: resp.statusText, body: errText });
      throw new Meteor.Error('openai-failed', errText);
    }
    const data = await resp.json();
    // Extract tool calls (Responses API emits 'function_call' items in output[])
    const toolCalls = extractResponsesToolCalls(data);
    
    const outputArray = Array.isArray(data?.output) ? data.output : [];
    let text = data?.output_text || (outputArray.length ? outputArray.map(p => p?.content?.[0]?.text || '').join('') : '') || '';
    let toolResults = [];

    if (toolCalls.length > 0) {
      toolResults = [];
      const memory = { ids: {}, entities: {}, lists: {}, params: {}, errors: [], projectId: null, projectName: null, tasks: [] };
      for (const call of toolCalls) {
        if (call.name === 'chat_tasks') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasks', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasks] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_overdue') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_overdue', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_overdue] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_tasksByProject') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasksByProject', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasksByProject] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_tasksFilter') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_tasksFilter', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_tasksFilter] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_projectsList') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_projectsList', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_projectsList] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_projectByName') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
          } catch (e) {
            toolResults.push({ tool_call_id: call.id || 'chat_projectByName', output: JSON.stringify({ error: e?.message || String(e) }) });
            console.error('[chat.ask][chat_projectByName] execution error:', e?.message || e);
          }
        } else if (call.name === 'chat_semanticSearch') {
          try {
            const exec = await executeStep({ tool: call.name, args: call.arguments || {} }, memory, call.id || undefined);
            toolResults.push({ tool_call_id: exec.tool_call_id, output: exec.output });
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
      const resp2 = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'o4-mini', messages: cmplMessages })
      }, 30000);
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        console.error('[chat.ask] OpenAI final synthesis failed', { status: resp2.status, statusText: resp2.statusText, body: errText2 });
        throw new Meteor.Error('openai-failed', errText2);
      }
      const data2 = await resp2.json();
      text = data2?.choices?.[0]?.message?.content || '';
    }
    
    // Build citations from toolResults if semantic search was used
    const citations = buildCitationsFromToolResults(toolCalls, toolResults);
    const base = { role: 'assistant', content: text, createdAt: new Date() };
    await ChatsCollection.insertAsync(citations.length ? { ...base, citations } : base);
    return { text, citations };
  },
  
});
