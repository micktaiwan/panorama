import { Meteor } from 'meteor/meteor';
import { chatComplete } from '/imports/api/_shared/llmProxy';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ChatsCollection } from '/imports/api/chats/collections';
import { TOOL_HANDLERS } from '/imports/api/tools/handlers';
import { TOOL_SCHEMAS } from '/imports/api/tools/schemas';
import { bindArgsWithMemory, evaluateStopWhen, capToolCalls, mapToolCallsForChatCompletions, buildProjectByNameSelector } from '/imports/api/tools/helpers';
import { TOOL_DEFINITIONS, buildCitationsFromMemory, buildCitationsFromToolResults, buildPlannerConfig } from '/imports/api/tools/definitions';
import { COLLECTION } from '/imports/api/search/vectorStore';

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

// TOOL_HANDLERS and TOOL_SCHEMAS now imported from /imports/api/tools/

// Attempt to resolve missing projectId from known project name in args or memory.

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

    // Mini planner: analyze intent → JSON plan (≤5 steps)
    await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning…', isStatus: true, createdAt: new Date() });
    const { plannerSchema, plannerPrompt, plannerMessages } = buildPlannerConfig(
      buildSystemPrompt(),
      user,
      Object.keys(TOOL_SCHEMAS)
    );
    let plannerResp;
    try {
      const result = await chatComplete({
        system: plannerPrompt,
        messages: plannerMessages,
        timeoutMs: 30000,
        responseFormat: 'json',
        schema: plannerSchema
      });
      plannerResp = { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: result.content } }] }) };
    } catch (plannerError) {
      console.error('[chat.ask][planner] error:', plannerError);
      
      // Check if it's a tool calls not supported error
      if (plannerError.reason?.includes('does not support tools')) {
        console.log('[chat.ask][planner] Model does not support tool calls, falling back to auto tools');
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Model does not support planning. Using auto tools instead.', isStatus: true, createdAt: new Date() });
      } else {
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning failed. Falling back to auto tools.', error: true, createdAt: new Date() });
      }
      plannerResp = { ok: false };
    }
    let planned = null;
    let stopArtifacts = [];
    if (plannerResp.ok) {
      const pdata = await plannerResp.json();
      const ptext = pdata?.choices?.[0]?.message?.content || '';
      console.log('[chat.ask][planner] Raw JSON response:', ptext.slice(0, 500));
      try {
        planned = JSON.parse(ptext);
        stopArtifacts = Array.isArray(planned?.stopWhen?.have) ? planned.stopWhen.have : [];
        if (planned && planned.steps) {
          console.log('[chat.ask][planner] Generated plan:', JSON.stringify({
            steps: planned.steps.map(s => ({ tool: s.tool, args: s.args })),
            stopWhen: planned.stopWhen
          }, null, 2));
        } else {
          console.log('[chat.ask][planner] Parsed plan has no steps:', JSON.stringify(planned));
        }
      } catch (ePlan) {
        console.error('[chat.ask][planner] JSON parse failed:', ePlan.message, 'Content:', ptext.slice(0, 200));
        planned = null;
        await ChatsCollection.insertAsync({ role: 'assistant', content: 'Planning failed - falling back to auto tools.', isStatus: true, createdAt: new Date() });
      }
    } else {
      console.error('[chat.ask][planner] Planner failed:', plannerResp);
      await ChatsCollection.insertAsync({ role: 'assistant', content: `Planner error: temporarily unavailable. Falling back to auto tools.`, error: true, createdAt: new Date() });
    }
    // If planner produced steps, execute them then synthesize; else fallback to auto tools
    const rawSteps = (EXECUTE_PLANNER_STEPS && planned && Array.isArray(planned.steps) && planned.steps.length > 0) ? planned.steps : [];
    // Filter out invalid tool names (like stopWhen.have, lists.tasks, etc.)
    const execSteps = rawSteps.filter(step => {
      const toolName = String(step.tool || '').trim();
      return toolName && TOOL_HANDLERS[toolName] && !toolName.includes('.');
    });
    if (execSteps && execSteps.length > 0) {
      await ChatsCollection.insertAsync({ role: 'assistant', content: 'Executing plan…', isStatus: true, createdAt: new Date() });
      const toolResults = [];
      // Generic working memory structure
      const memory = {
        ids: {},
        entities: {},
        lists: {},
        params: {
          userQuery: query  // Store original user query for semantic search fallback
        },
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

          // Log step result with count
          let shouldReplan = false;
          let replanReason = '';
          try {
            const resultPayload = JSON.parse(result.output || '{}');
            const count = resultPayload.total ?? resultPayload.results?.length ?? resultPayload.tasks?.length ?? resultPayload.projects?.length ?? 0;
            console.log(`[chat.ask][step] Executed: ${step.tool}, returned ${count} items`);

            // Check if we should re-plan due to empty results
            if (count === 0 && !resultPayload.error) {
              shouldReplan = true;
              replanReason = `Tool ${step.tool} returned 0 results`;
            }
          } catch {
            console.error('[chat.ask][planner][tool output] parse failed', { tool: step.tool, length: (result.output || '').length });
          }

          // Trigger re-planning on empty results
          if (shouldReplan) {
            console.log(`[chat.ask][replan] Triggering re-plan: ${replanReason}`);
            await ChatsCollection.insertAsync({ role: 'assistant', content: 'Re-planning…', isStatus: true, createdAt: new Date() });

            // Build memory snapshot for re-planning
            const mem = {
              ids: memory.ids || {},
              entities: memory.entities || {},
              lists: memory.lists || {},
              params: memory.params || {},
              previousTool: step.tool,
              previousArgs: step.args,
              reason: replanReason,
              resultsCount: toolResults.map(tr => {
                try {
                  const p = JSON.parse(tr.output || '{}');
                  return { tool: tr.tool, count: p.total ?? 0 };
                } catch { return { tool: tr.tool, count: 0 }; }
              })
            };

            const replanUserPrompt = [
              user,
              '',
              'Previous execution summary:',
              `- Tried: ${step.tool}`,
              `- Result: ${replanReason}`,
              '',
              'Memory snapshot:',
              JSON.stringify(mem, null, 2),
              '',
              'Please try a different approach or use multiple tools.'
            ].join('\n');

            try {
              const { plannerSchema: replanSchema, plannerPrompt: pp } = buildPlannerConfig(buildSystemPrompt(), replanUserPrompt, Object.keys(TOOL_SCHEMAS));
              const result2 = await chatComplete({
                system: pp,
                messages: [
                  { role: 'system', content: `${buildSystemPrompt()} Allowed tools: ${Object.keys(TOOL_SCHEMAS).join(', ')}. ${pp}` },
                  { role: 'user', content: replanUserPrompt }
                ],
                timeoutMs: 30000,
                responseFormat: 'json',
                schema: replanSchema
              });

              const ptext2 = result2.content || '';
              try {
                const planned2 = JSON.parse(ptext2);
                const steps2 = Array.isArray(planned2?.steps) ? planned2.steps : [];
                console.log('[chat.ask][replan] New plan:', JSON.stringify(steps2.map(s => s.tool), null, 2));

                // Execute re-planned steps with remaining budget
                const remain = Math.max(0, MAX_STEPS - i - 1);
                for (let j = 0; j < Math.min(steps2.length, remain); j += 1) {
                  try {
                    const stepJ = steps2[j] || {};
                    await ChatsCollection.insertAsync({ role: 'assistant', content: `Running tool: ${stepJ.tool}…`, isStatus: true, createdAt: new Date() });
                    const replanResult = await executeStep(stepJ, memory, `call_re_${j+1}`);
                    toolResults.push(replanResult);

                    // Log re-planned step result
                    try {
                      const rpPayload = JSON.parse(replanResult.output || '{}');
                      const rpCount = rpPayload.total ?? rpPayload.results?.length ?? 0;
                      console.log(`[chat.ask][replan][step] Executed: ${stepJ.tool}, returned ${rpCount} items`);
                    } catch {}
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
            } catch (fetchError) {
              console.error('[chat.ask][replan] error:', fetchError);
            }
            break; // Exit main loop after re-planning
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
              const result2 = await chatComplete({
                system: `${buildSystemPrompt()} Allowed tools: ${Object.keys(TOOL_SCHEMAS).join(', ')}. ${plannerPrompt}`,
                messages: replanMessages,
                timeoutMs: 30000,
                responseFormat: 'json',
                schema: plannerSchema
              });
              const ptext2 = result2.content || '';
              console.log('[chat.ask][replan] Raw JSON response:', ptext2.slice(0, 500));
              try {
                const planned2 = JSON.parse(ptext2);
                const steps2 = Array.isArray(planned2?.steps) ? planned2.steps : [];
                if (planned2 && planned2.steps) {
                  console.log('[chat.ask][replan] Generated plan:', JSON.stringify({
                    steps: planned2.steps.map(s => ({ tool: s.tool, args: s.args })),
                    stopWhen: planned2.stopWhen
                  }, null, 2));
                } else {
                  console.log('[chat.ask][replan] Parsed plan has no steps:', JSON.stringify(planned2));
                }
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
            } catch (fetchError) {
              console.error('[chat.ask][replan] error:', fetchError);
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
          console.log('[chat.ask][stopWhen] Condition met, stopping execution early');
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

      // Check if all results are empty
      const allResultsEmpty = parsedResults.every(pr => {
        const p = pr._payload || {};
        const count = p.total ?? p.results?.length ?? p.tasks?.length ?? p.projects?.length ?? 0;
        return count === 0;
      });

      // Build synthesis prompt based on whether results are empty
      let synthSys = "You are Panorama's assistant. Compose the final answer using ONLY the tool results. Include all items and the total count. Be concise. Do NOT show internal IDs (task or project). Show only human-readable fields (title, status, deadline).";
      let synthUser = `Answer the user's question: "${query}" using only the provided tool results.`;

      if (allResultsEmpty) {
        console.log('[chat.ask][synthesis] All results empty, using informative message prompt');
        synthSys = "You are Panorama's assistant. The search returned no results. Explain clearly why no results were found based on the search criteria. If possible, suggest related information or alternative searches.";
        synthUser = `The user asked: "${query}". All tools returned 0 results. Provide a clear, helpful explanation and suggest alternatives if relevant.`;
      }

      const cmplMessages = [ { role: 'system', content: synthSys }, { role: 'user', content: synthUser }, assistantToolCallMsg, ...toolMsgs ];
      
      let data2;
      try {
        const result2 = await chatComplete({
          messages: cmplMessages,
          timeoutMs: 30000
        });
        data2 = { choices: [{ message: { content: result2.content } }] };
      } catch (synthError) {
        console.error('[chat.ask][planner] final synthesis failed', synthError);
        throw new Meteor.Error('openai-failed', `Synthesis failed: ${synthError.message || synthError.reason}`);
      }
      const text = data2?.choices?.[0]?.message?.content || '';
      const citations = buildCitationsFromMemory(memory);
      const base = { role: 'assistant', content: text, createdAt: new Date() };
      await ChatsCollection.insertAsync(citations.length ? { ...base, citations } : base);
      return { text, citations };
    }
    
    // Fallback path - use Chat Completions with tool calls via proxy
    // Convert Responses API approach to standard Chat Completions with tools
    const tools = TOOL_DEFINITIONS.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      }
    }));

    // First call to get tool calls
    const result = await chatComplete({
      system,
      messages: [{ role: 'user', content: user }],
      tools,
      tool_choice: 'auto',
      timeoutMs: 30000
    });

    const toolCalls = result.tool_calls || [];
    let text = result.content || '';
    let toolResults = [];

    if (toolCalls.length > 0) {
      toolResults = [];
      const memory = { ids: {}, entities: {}, lists: {}, params: {}, errors: [], projectId: null, projectName: null, tasks: [] };
      
      for (const call of toolCalls) {
        try {
          const exec = await executeStep({ 
            tool: call.function.name, 
            args: call.function.arguments || {} 
          }, memory, call.id);
          toolResults.push({ 
            tool_call_id: call.id, 
            output: exec.output 
          });
        } catch (e) {
          console.error(`[chat.ask][${call?.function?.name || 'unknown_tool'}] execution error:`, e?.message || e);
          toolResults.push({ 
            tool_call_id: call.id || 'call_0', 
            output: JSON.stringify({ error: e?.message || String(e) }) 
          });
        }
      }
      
      // Final synthesis call via Chat Completions
      const assistantToolCallMsg = {
        role: 'assistant',
        tool_calls: toolCalls
      };
      const toolMsgs = toolResults.map(tr => ({ 
        role: 'tool', 
        tool_call_id: tr.tool_call_id, 
        content: tr.output || '{}' 
      }));
      const synthesisGuidance = 'Use ONLY the tool results; list all returned items with concise human-friendly fields and include total counts where applicable. Do NOT show internal IDs.';
      const cmplMessages = [
        { role: 'system', content: system + ' ' + synthesisGuidance },
        { role: 'user', content: user },
        assistantToolCallMsg,
        ...toolMsgs
      ];
      
      const result2 = await chatComplete({
        messages: cmplMessages,
        timeoutMs: 30000
      });
      text = result2.content || '';
    }
    
    // Build citations from toolResults if semantic search was used
    const citations = buildCitationsFromToolResults(toolCalls, toolResults);
    const base = { role: 'assistant', content: text, createdAt: new Date() };
    await ChatsCollection.insertAsync(citations.length ? { ...base, citations } : base);
    return { text, citations };
  },
  
});
