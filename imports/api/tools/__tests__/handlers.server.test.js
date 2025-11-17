import assert from 'assert';
import { TOOL_HANDLERS } from '/imports/api/tools/handlers';

describe('Tool handlers (TDD - nouvelle structure)', function () {
  it('tool_tasksFilter should return all tasks with empty args', async function () {
    const result = await TOOL_HANDLERS.tool_tasksFilter({}, {});
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.total > 0, 'Should return at least one task');
    assert.ok(Array.isArray(parsed.tasks), 'Should return tasks array');
  });

  it('tool_tasksFilter should filter by important flag', async function () {
    const result = await TOOL_HANDLERS.tool_tasksFilter({ important: true }, {});
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.tasks.every(t => t.isImportant === true), 'All tasks should be important');
  });

  it('tool_projectsList should return projects', async function () {
    const result = await TOOL_HANDLERS.tool_projectsList({}, {});
    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.projects), 'Should return projects array');
    assert.ok(parsed.total >= 0, 'Should have total count');
  });

  it('tool_projectByName should find projects by name (partial match)', async function () {
    // First get a project name
    const listResult = await TOOL_HANDLERS.tool_projectsList({}, {});
    const projects = JSON.parse(listResult.output).projects;
    if (projects.length === 0) return; // Skip if no projects

    const firstProject = projects[0];
    const result = await TOOL_HANDLERS.tool_projectByName({ name: firstProject.name }, {});
    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.projects), 'Should return a projects array');
    assert.ok(parsed.projects.length > 0, 'Should find at least one project');
    assert.ok(parsed.total >= 1, 'Should have total count');
    // Verify at least one project matches the search term
    const matches = parsed.projects.some(p => p.name.toLowerCase().includes(firstProject.name.toLowerCase()));
    assert.ok(matches, 'Should contain at least one project matching the search term');
  });

  it('tool_createTask should create task', async function () {
    const title = `Test task from TDD ${Date.now()}`;
    const result = await TOOL_HANDLERS.tool_createTask(
      { title, status: 'todo' },
      {}
    );
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.taskId, 'Should return taskId');
    assert.strictEqual(parsed.title, title, 'Should return task title');
  });

  it('tool_updateTask should update task', async function () {
    // Create task first
    const createResult = await TOOL_HANDLERS.tool_createTask(
      { title: `Task to update ${Date.now()}` },
      {}
    );
    const { taskId } = JSON.parse(createResult.output);

    // Update it
    const updateResult = await TOOL_HANDLERS.tool_updateTask(
      { taskId, notes: 'Updated from TDD test' },
      {}
    );
    const parsed = JSON.parse(updateResult.output);
    assert.strictEqual(parsed.updated, true, 'Should confirm update');
    assert.strictEqual(parsed.taskId, taskId, 'Should return taskId');
  });

  it('tool_semanticSearch should search workspace', async function () {
    const result = await TOOL_HANDLERS.tool_semanticSearch(
      { query: 'project management', limit: 5 },
      {}
    );
    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.results), 'Should return results array');
  });

  it('tool_listTools should list all tools', async function () {
    const result = await TOOL_HANDLERS.tool_listTools({}, {});
    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.tools), 'Should return tools array');
    assert.ok(parsed.total > 15, 'Should have at least 15 tools');
    // Verify all tools start with tool_ prefix
    const allHavePrefix = parsed.tools.every(t => t.name.startsWith('tool_'));
    assert.ok(allHavePrefix, 'All tools should have tool_ prefix');
  });
});
