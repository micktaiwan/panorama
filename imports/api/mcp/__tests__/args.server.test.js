import assert from 'assert';
import { unknownArgs } from '/imports/api/mcp/server/handlers/args';
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

  it('leaves open schemas alone', function () {
    assert.deepStrictEqual(unknownArgs({ type: 'object', properties: {} }, { anything: 1 }), []);
  });
});
