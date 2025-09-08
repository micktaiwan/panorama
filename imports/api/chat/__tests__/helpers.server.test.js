import assert from 'assert';
import { buildTasksSelector, mapToolCallsForChatCompletions, buildOverdueSelector, buildByProjectSelector, buildFilterSelector } from '/imports/api/chat/helpers.js';

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
});


