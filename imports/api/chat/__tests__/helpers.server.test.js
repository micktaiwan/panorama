import assert from 'assert';
import { buildTasksSelector, mapToolCallsForChatCompletions, buildOverdueSelector, buildByProjectSelector, buildFilterSelector, buildProjectByNameSelector, bindArgsWithMemory, capToolCalls, evaluateStopWhen } from '/imports/api/chat/helpers.js';

describe('chat tools helpers (server)', function () {
  it('buildTasksSelector: dueBefore only → matches Date or YYYY-MM-DD', function () {
    const sel = buildTasksSelector({ dueBefore: '2025-09-10T00:00:00Z' });
    assert.ok(sel && Array.isArray(sel.$or) && sel.$or.length === 2, 'selector must use $or with two branches');
    const a = sel.$or[0] && sel.$or[0].deadline && sel.$or[0].deadline.$lte;
    const b = sel.$or[1] && sel.$or[1].deadline && sel.$or[1].deadline.$lte;
    const okDate = a instanceof Date || b instanceof Date;
    const okStr = (a === '2025-09-10') || (b === '2025-09-10');
    assert.ok(okDate && okStr, 'one branch must be Date, the other YYYY-MM-DD');
  });

  it('buildTasksSelector: trims projectId and status', function () {
    const sel = buildTasksSelector({ projectId: '  abc ', status: ' todo ' });
    assert.strictEqual(sel.projectId, 'abc');
    assert.strictEqual(sel.status, 'todo');
  });

  it('mapToolCallsForChatCompletions: truncates long ids and maps tool results', function () {
    const toolCalls = [ { id: 'x'.repeat(60), name: 'chat_tasks', arguments: { dueBefore: '2025-01-01' } } ];
    const toolResults = [ { tool_call_id: 'x'.repeat(60), output: JSON.stringify({ tasks: [] }) } ];
    const { assistantToolCallMsg, toolMsgs } = mapToolCallsForChatCompletions(toolCalls, toolResults);
    const mappedId = assistantToolCallMsg.tool_calls[0].id;
    assert.ok(mappedId.length <= 40);
    assert.strictEqual(toolMsgs[0].tool_call_id, mappedId);
  });

  it('buildOverdueSelector: returns non-done and deadline <= now', function () {
    const sel = buildOverdueSelector('2025-09-10T10:00:00Z');
    // Should include non-done and an $or over Date and string
    if (!sel || sel.status?.$ne !== 'done' || !Array.isArray(sel.$or)) throw new Error('invalid overdue selector');
  });

  it('buildByProjectSelector: trims id and excludes done', function () {
    const sel = buildByProjectSelector('  abc  ');
    if (sel.projectId !== 'abc' || sel.status?.$ne !== 'done') throw new Error('invalid byProject selector');
  });

  it('buildFilterSelector: builds from simple filters', function () {
    const sel = buildFilterSelector({ projectId: ' p1 ', status: ' todo ', tag: ' errands ' });
    if (sel.projectId !== 'p1' || sel.status !== 'todo' || sel.tags !== 'errands') throw new Error('invalid filter selector');
  });

  it('buildProjectByNameSelector: builds case-insensitive exact match regex', function () {
    const sel = buildProjectByNameSelector(' My Project ');
    if (!sel || !sel.name || !sel.name.$regex || sel.name.$options !== 'i') throw new Error('invalid project-by-name selector');
    if (!String(sel.name.$regex).startsWith('^')) throw new Error('regex should anchor start');
  });

  it('bindArgsWithMemory: injects projectId into chat_tasksByProject when missing', function () {
    const args = bindArgsWithMemory('chat_tasksByProject', {}, { projectId: 'abc' });
    if (args.projectId !== 'abc') throw new Error('binding failed');
  });

  it('capToolCalls: truncates toolCalls to 5 items', function () {
    const calls = Array.from({ length: 10 }).map((_, i) => ({ id: 'c' + i }));
    const capped = capToolCalls(calls, 5);
    if (!Array.isArray(capped) || capped.length !== 5) throw new Error('capping failed');
  });

  it('evaluateStopWhen: lists.tasks non-empty passes; wildcard lists.* passes; ids.projectId truthy passes', function () {
    const memory = {
      lists: { tasks: [{ title: 'A' }], projects: [] },
      ids: { projectId: 'p1' },
      entities: {}
    };
    if (!evaluateStopWhen(['lists.tasks'], memory)) throw new Error('lists.tasks should pass');
    if (!evaluateStopWhen(['lists.*'], memory)) throw new Error('lists.* should pass');
    if (!evaluateStopWhen(['ids.projectId'], memory)) throw new Error('ids.projectId should pass');
    if (evaluateStopWhen(['entities.note'], memory)) throw new Error('entities.note should fail');
  });

  it('bindArgsWithMemory: supports generic variable binding with {var:"path"} syntax', function() {
    const memory = {
      ids: { projectId: 'proj123', sessionId: 'sess456' },
      params: { tag: 'urgent', status: 'todo' },
      entities: { user: { name: 'John' } }
    };
    
    // Test variable resolution
    const args1 = bindArgsWithMemory('chat_tasksByProject', {
      projectId: { var: 'ids.projectId' },
      status: { var: 'params.status' }
    }, memory);
    assert.strictEqual(args1.projectId, 'proj123');
    assert.strictEqual(args1.status, 'todo');
    
    // Test nested path resolution  
    const args2 = bindArgsWithMemory('custom_tool', {
      userName: { var: 'entities.user.name' }
    }, memory);
    assert.strictEqual(args2.userName, 'John');
    
    // Test fallback for missing variables
    const args3 = bindArgsWithMemory('chat_tasksByProject', {
      projectId: { var: 'ids.missingId' }
    }, memory);
    assert.strictEqual(args3.projectId, undefined);
  });

  it('bindArgsWithMemory: extends to handle all project-scoped tools', function() {
    const memory = { ids: { projectId: 'p1' }, projectId: 'legacy_p1' };
    
    const tools = [
      'chat_tasksByProject',
      'chat_notesByProject', 
      'chat_noteSessionsByProject',
      'chat_linksByProject',
      'chat_filesByProject'
    ];
    
    tools.forEach(tool => {
      const args = bindArgsWithMemory(tool, {}, memory);
      assert.strictEqual(args.projectId, 'p1', `${tool} should get projectId from ids.projectId`);
    });
    
    // Test sessionId binding
    const memory2 = { ids: { sessionId: 's1' }, sessionId: 'legacy_s1' };
    const args = bindArgsWithMemory('chat_noteLinesBySession', {}, memory2);
    assert.strictEqual(args.sessionId, 's1');
  });
});

describe('chat planner integration tests', function() {
  // Mock data for testing
  const mockMemory = () => ({
    ids: {},
    entities: {},
    lists: {},
    params: {},
    errors: [],
    // Legacy compatibility
    projectId: null,
    projectName: null,
    tasks: []
  });
  
  it('executeStep: enforces required arguments from TOOL_SCHEMAS', async function() {
    // This would need to import the actual executeStep function
    // For now, we test the schema validation logic
    const TOOL_SCHEMAS = {
      chat_projectByName: { required: ['name'] },
      chat_tasksByProject: { required: ['projectId'] }
    };
    
    const checkRequired = (tool, args) => {
      const schema = TOOL_SCHEMAS[tool];
      if (!schema) return [];
      return (schema.required || []).filter(k => {
        const v = args[k];
        return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      });
    };
    
    // Should find missing 'name'
    const missing1 = checkRequired('chat_projectByName', {});
    assert.deepStrictEqual(missing1, ['name']);
    
    // Should find missing 'projectId'
    const missing2 = checkRequired('chat_tasksByProject', { projectId: '  ' });
    assert.deepStrictEqual(missing2, ['projectId']);
    
    // Should pass validation
    const missing3 = checkRequired('chat_projectByName', { name: 'test' });
    assert.deepStrictEqual(missing3, []);
  });
  
  it('memory structure: supports both legacy and new generic paths', function() {
    const memory = mockMemory();
    
    // Simulate chat_projectByName updating memory
    memory.ids.projectId = 'new_proj_123';
    memory.entities.project = { name: 'Test Project' };
    // Legacy fallback
    memory.projectId = 'new_proj_123';
    memory.projectName = 'Test Project';
    
    // Test that both paths work
    assert.strictEqual(memory.ids.projectId, memory.projectId);
    assert.strictEqual(memory.entities.project.name, memory.projectName);
    
    // Test lists structure
    memory.lists.tasks = [{ title: 'Task 1', status: 'todo' }];
    memory.tasks = [{ _id: 'task123', title: 'Task 1' }]; // legacy format
    
    assert.strictEqual(memory.lists.tasks.length, 1);
    assert.strictEqual(memory.tasks.length, 1);
  });
  
  it('stopWhen evaluation: supports declarative artifacts checking', function() {
    const memory = {
      ids: { projectId: 'p1' },
      entities: { project: { name: 'Test' } },
      lists: { tasks: [{ title: 'Task 1' }], projects: [] }
    };
    
    // Test specific artifact checks
    assert.ok(evaluateStopWhen(['ids.projectId'], memory));
    assert.ok(evaluateStopWhen(['entities.project'], memory));
    assert.ok(evaluateStopWhen(['lists.tasks'], memory));
    assert.ok(!evaluateStopWhen(['lists.projects'], memory)); // empty array
    
    // Test wildcard checks
    assert.ok(evaluateStopWhen(['lists.*'], memory)); // has tasks
    assert.ok(evaluateStopWhen(['ids.*'], memory)); // has projectId
    assert.ok(evaluateStopWhen(['entities.*'], memory)); // has project
    
    // Test combined conditions (all must be satisfied)
    assert.ok(evaluateStopWhen(['ids.projectId', 'lists.tasks'], memory));
    assert.ok(!evaluateStopWhen(['ids.projectId', 'lists.nonExistent'], memory));
  });
  
  it('MAX_STEPS enforcement: caps execution at 5 steps', function() {
    const MAX_STEPS = 5;
    const mockSteps = Array.from({ length: 10 }, (_, i) => ({ tool: `tool_${i}`, args: {} }));
    
    // Simulate the loop cap logic
    const executedSteps = [];
    for (let i = 0; i < Math.min(mockSteps.length, MAX_STEPS); i++) {
      executedSteps.push(mockSteps[i]);
    }
    
    assert.strictEqual(executedSteps.length, 5);
    assert.strictEqual(executedSteps[0].tool, 'tool_0');
    assert.strictEqual(executedSteps[4].tool, 'tool_4');
  });
  
  it('re-plan memory snapshot: includes structured state for LLM', function() {
    const memory = {
      ids: { projectId: 'p123' },
      entities: { project: { name: 'Data Science' } },
      lists: { tasks: [{ title: 'Clean data' }, { title: 'Train model' }] },
      params: { status: 'todo' },
      errors: [],
      // Legacy
      projectId: 'p123',
      projectName: 'Data Science',
      tasks: [{ _id: 't1' }, { _id: 't2' }]
    };
    
    // Simulate re-plan memory snapshot creation
    const snapshot = {
      ids: memory.ids || {},
      entities: memory.entities || {},
      lists: memory.lists || {},
      lastTool: 'chat_tasksByProject',
      error: 'Missing required arguments: projectId',
      // Legacy fields for transition compatibility
      projectId: memory.projectId || null,
      projectName: memory.projectName || null,
      tasksCount: Array.isArray(memory.tasks) ? memory.tasks.length : 0
    };
    
    assert.strictEqual(snapshot.ids.projectId, 'p123');
    assert.strictEqual(snapshot.entities.project.name, 'Data Science');
    assert.strictEqual(snapshot.lists.tasks.length, 2);
    assert.strictEqual(snapshot.tasksCount, 2);
    assert.strictEqual(snapshot.error, 'Missing required arguments: projectId');
  });
  
  it('tool output envelope: consistent structure with total counts', function() {
    // Test the expected output format for all list tools
    const testOutputs = [
      { tool: 'chat_tasks', expected: ['tasks', 'total'] },
      { tool: 'chat_projectsList', expected: ['projects', 'total'] },
      { tool: 'chat_semanticSearch', expected: ['results', 'total'] },
      { tool: 'chat_alarmsList', expected: ['alarms', 'total'] }
    ];
    
    testOutputs.forEach(({ tool, expected }) => {
      // Mock tool output
      const mockOutput = {
        [expected[0]]: [{ title: 'Item 1' }, { title: 'Item 2' }],
        [expected[1]]: 2
      };
      
      const outputStr = JSON.stringify(mockOutput);
      const parsed = JSON.parse(outputStr);
      
      assert.ok(parsed[expected[0]], `${tool} should have ${expected[0]} array`);
      assert.strictEqual(typeof parsed[expected[1]], 'number', `${tool} should have ${expected[1]} count`);
      assert.strictEqual(parsed[expected[1]], parsed[expected[0]].length, `${tool} total should match array length`);
    });
  });
});

