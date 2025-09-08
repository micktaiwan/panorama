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
import { buildTasksSelector, buildOverdueSelector, buildByProjectSelector, buildFilterSelector } from '/imports/api/chat/helpers';

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
  const q = String(rawQuery || '').toLowerCase();
  const lines = [];
  // Heuristics from common phrasings
  if (/overdue|retard/.test(q)) lines.push('Overdue tasks (<= now)');
  if (/tomorrow|demain/.test(q)) lines.push('Tasks due by tomorrow 23:59');
  const projectMatch = /project\s+([\w-]{6,})/i.exec(rawQuery || '');
  if (projectMatch && projectMatch[1]) lines.push(`Tasks for project ${projectMatch[1]}`);
  const tagQuoted = /tag(?:ged)?[^"\n]*"([^"]+)"/i.exec(rawQuery || '');
  const tagBare = !tagQuoted && /tag\s+([\w-]{2,})/i.exec(rawQuery || '');
  if (tagQuoted && tagQuoted[1]) lines.push(`Tasks with tag "${tagQuoted[1]}"`);
  else if (tagBare && tagBare[1]) lines.push(`Tasks with tag "${tagBare[1]}"`);
  // Fallback to planned tool names when heuristics found nothing
  if (lines.length === 0 && Array.isArray(plannedSteps) && plannedSteps.length > 0) {
    for (let i = 0; i < plannedSteps.length; i += 1) {
      const s = plannedSteps[i] || {};
      const argsStr = safeStringify(s.args || {});
      lines.push(`${s.tool || 'tool'} ${argsStr}`.trim());
    }
  }
  if (lines.length === 0) return 'Plan: (empty)';
  return ['Plan:', ...lines.map((t, idx) => `${idx + 1}. ${t}`)].join('\n');
};

const fmtYmd = (iso) => {
  const s = String(iso || '');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

const labelForToolStep = (tool, args = {}) => {
  const t = String(tool || '');
  if (t === 'chat_overdue') return 'Overdue tasks (<= now)';
  if (t === 'chat_tasks') {
    const ymd = args && args.dueBefore ? fmtYmd(args.dueBefore) : 'tomorrow 23:59';
    return `Tasks due before ${ymd}`;
  }
  if (t === 'chat_tasksByProject') return 'Tasks for selected project';
  if (t === 'chat_tasksFilter') {
    const bits = [];
    if (args && args.status) bits.push(`status=${args.status}`);
    if (args && args.tag) bits.push(`tag=${args.tag}`);
    if (args && args.projectId) bits.push(`projectId=${args.projectId}`);
    return bits.length > 0 ? `Tasks filtered by ${bits.join(', ')}` : 'Tasks (no filters)';
  }
  return t || 'Tasks';
};


Meteor.methods({
  async 'chat.ask'(payload) {
    const query = String(payload?.query || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (!query) throw new Meteor.Error('bad-request', 'query is required');

    // Vector search (RAG)
    const url = getQdrantUrl();
    const client = new QdrantClient({ url });
    const vector = await embedQuery(query);
    const searchRes = await client.search(COLLECTION(), { vector, limit: 8, with_payload: true });
    const items = Array.isArray(searchRes) ? searchRes : (searchRes?.result || []);
    const sources = [];
    for (let i = 0; i < items.length; i += 1) {
      const p = items[i]?.payload || {};
      const docId = p.docId || null;
      if (!docId) continue;
      const prev = await fetchPreview(p.kind, p.docId);
      sources.push({ id: docId, kind: p.kind, title: prev.title, text: prev.text, url: prev.url || null, projectId: p.projectId || null, sessionId: p.sessionId || null, score: items[i]?.score });
    }

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
              tool: { type: 'string', enum: ['chat_tasks', 'chat_overdue', 'chat_tasksByProject', 'chat_tasksFilter'] },
              args: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  dueBefore: { type: 'string' },
                  projectId: { type: 'string' },
                  status: { type: 'string' },
                  now: { type: 'string' },
                  tag: { type: 'string' }
                }
              }
            },
            required: ['tool', 'args']
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
      'Use chat_tasksByProject when a project is specified.',
      'Use chat_tasksFilter for status/tag filters.',
      'Output JSON only that matches the schema. Keep at most 5 steps.'
    ].join(' ');
    const plannerMessages = [
      { role: 'system', content: `${buildSystemPrompt()} Allowed tools: chat_tasks. ${plannerPrompt}` },
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
    if (plannerResp.ok) {
      const pdata = await plannerResp.json();
      const ptext = pdata?.choices?.[0]?.message?.content || '';
      try {
        planned = JSON.parse(ptext);
        console.log('[chat.ask][planner] plan:', safeStringify(planned));
        try {
          const steps = Array.isArray(planned?.steps) ? planned.steps : [];
          const hasExplicit = steps && steps.length > 0;
          let human = buildReadablePlan(query, steps);
          if (hasExplicit) {
            const lines = steps.map((s, idx) => `${idx + 1}. ${labelForToolStep(s.tool, s.args)}`);
            human = ['Plan:', ...lines].join('\n');
          }
          await ChatsCollection.insertAsync({ role: 'assistant', content: human, isStatus: true, createdAt: new Date() });
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
      for (let i = 0; i < Math.min(execSteps.length, 5); i += 1) {
        const step = execSteps[i] || {};
        const tool = String(step.tool || '');
        const args = step.args || {};
        if (tool === 'chat_tasks') {
          try {
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasks…', isStatus: true, createdAt: new Date() });
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildTasksSelector } = await import('/imports/api/chat/helpers');
            const normArgs = { ...args };
            // Respect planner-provided dueBefore; default only if missing
            if (!normArgs.dueBefore) normArgs.dueBefore = computeTomorrowEndOfDayISO();
            // Keep Panorama default: exclude completed unless explicitly requested (planner doesn't set it today)
            if (normArgs.status) delete normArgs.status;
            const selector = buildTasksSelector(normArgs);
            if (!('status' in selector)) selector.status = { $ne: 'done' };
            console.log('[chat.ask][planner][chat_tasks] selector:', safeStringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
          } catch (e) {
            console.error('[chat.ask][planner][chat_tasks] exec failed', e);
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
          }
        } else if (tool === 'chat_overdue') {
          try {
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_overdue…', isStatus: true, createdAt: new Date() });
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildOverdueSelector } = await import('/imports/api/chat/helpers');
            const nowIso = (args && typeof args.now === 'string' && args.now.trim()) ? args.now : new Date().toISOString();
            const selector = buildOverdueSelector(nowIso);
            console.log('[chat.ask][planner][chat_overdue] selector:', safeStringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
          } catch (e) {
            console.error('[chat.ask][planner][chat_overdue] exec failed', e);
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
          }
        } else if (tool === 'chat_tasksByProject') {
          try {
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasksByProject…', isStatus: true, createdAt: new Date() });
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildByProjectSelector } = await import('/imports/api/chat/helpers');
            const selector = buildByProjectSelector(args && args.projectId);
            console.log('[chat.ask][planner][chat_tasksByProject] selector:', safeStringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
          } catch (e) {
            console.error('[chat.ask][planner][chat_tasksByProject] exec failed', e);
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
          }
        } else if (tool === 'chat_tasksFilter') {
          try {
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Running tool: chat_tasksFilter…', isStatus: true, createdAt: new Date() });
            const { TasksCollection } = await import('/imports/api/tasks/collections');
            const { buildFilterSelector } = await import('/imports/api/chat/helpers');
            const selector = buildFilterSelector(args || {});
            console.log('[chat.ask][planner][chat_tasksFilter] selector:', safeStringify(selector));
            const fields = { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } };
            const tasks = await TasksCollection.find(selector, fields).fetchAsync();
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ tasks: tasks.map(t => ({ id: t._id, title: t.title || '', projectId: t.projectId || null, status: t.status || 'todo', deadline: t.deadline || null })) }) });
          } catch (e) {
            console.error('[chat.ask][planner][chat_tasksFilter] exec failed', e);
            toolResults.push({ tool_call_id: `call_${i+1}`, output: JSON.stringify({ error: e?.message || String(e) }) });
          }
        }
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
        const snippet = String(text).slice(0, 400);
        console.log('[chat.ask][planner] Output length:', text.length);
        console.log('[chat.ask][planner] Output snippet:', snippet);
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
    const toolCalls = (toolCallsFromOutput.length > 0 ? toolCallsFromOutput : toolCallsTop);
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
      const synthesisGuidance = 'Use ONLY the tool results; include ALL tasks (do not sample). List them as bullets with titles, and include the total count.';
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
      const snippet = String(text).slice(0, 400);
      console.log('[chat.ask] Output length:', text.length);
      console.log('[chat.ask] Output snippet:', snippet);
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
