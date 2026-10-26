import assert from 'assert';
import { unknownArgs, unknownArgsMessage } from '/imports/api/mcp/server/handlers/args';
import { PANORAMA_MCP_TOOLS } from '/imports/api/mcp/server/handlers/index';

describe('MCP tools/call argument check', function () {
  const tasksFilter = PANORAMA_MCP_TOOLS.find(t => t.name === 'tool_tasksFilter');

  it('flags an argument a closed schema does not declare', function () {
    assert.deepStrictEqual(unknownArgs(tasksFilter.inputSchema, { text: 'api' }), ['text']);
  });

  it('accepts declared arguments and empty calls', function () {
    assert.deepStrictEqual(unknownArgs(tasksFilter.inputSchema, { status: 'todo', projectId: 'x' }), []);
    assert.deepStrictEqual(unknownArgs(tasksFilter.inputSchema, {}), []);
    assert.deepStrictEqual(unknownArgs(tasksFilter.inputSchema, undefined), []);
  });

  it('points id arguments to the generic by-id read', function () {
    assert.match(unknownArgsMessage('tool_tasksFilter', tasksFilter.inputSchema, ['ids']), /tool_collectionQuery/);
    assert.match(unknownArgsMessage('tool_tasksFilter', tasksFilter.inputSchema, ['taskId']), /tool_collectionQuery/);
    assert.doesNotMatch(unknownArgsMessage('tool_tasksFilter', tasksFilter.inputSchema, ['text']), /tool_collectionQuery/);
  });

  it('leaves open schemas alone', function () {
    assert.deepStrictEqual(unknownArgs({ type: 'object', properties: {} }, { anything: 1 }), []);
  });
});
