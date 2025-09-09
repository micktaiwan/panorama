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
});


