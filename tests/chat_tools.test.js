import assert from 'assert';
import { buildTasksSelector, mapToolCallsForChatCompletions } from '/imports/api/chat/helpers.js';

describe('chat tools helpers (pure, no DB writes)', function () {
  it('buildTasksSelector: dueBefore only → ISO date upper bound', function () {
    const sel = buildTasksSelector({ dueBefore: '2025-09-10T00:00:00Z' });
    assert.deepStrictEqual(sel, { deadline: { $lte: '2025-09-10' } });
  });

  it('buildTasksSelector: trims projectId and status', function () {
    const sel = buildTasksSelector({ projectId: '  abc ', status: ' todo ' });
    assert.strictEqual(sel.projectId, 'abc');
    assert.strictEqual(sel.status, 'todo');
  });

  it('mapToolCallsForChatCompletions: truncates long ids and maps tool results', function () {
    const toolCalls = [
      { id: 'x'.repeat(60), name: 'chat_tasks', arguments: { dueBefore: '2025-01-01' } }
    ];
    const toolResults = [
      { tool_call_id: 'x'.repeat(60), output: JSON.stringify({ tasks: [] }) }
    ];
    const { assistantToolCallMsg, toolMsgs } = mapToolCallsForChatCompletions(toolCalls, toolResults);
    const mappedId = assistantToolCallMsg.tool_calls[0].id;
    assert.ok(mappedId.length <= 40);
    assert.strictEqual(toolMsgs[0].tool_call_id, mappedId);
  });
});


