import assert from 'assert';
import { buildFilterSelector, bindArgsWithMemory, buildProjectByNameSelector } from '/imports/api/tools/helpers';

describe('Tool helpers (TDD - nouvelle structure)', function () {
  it('buildFilterSelector should support all filter types', function () {
    const sel = buildFilterSelector({
      projectId: 'abc123',
      status: 'todo',
      important: true,
      urgent: false,
      tag: 'home'
    });
    assert.strictEqual(sel.projectId, 'abc123');
    assert.strictEqual(sel.status, 'todo');
    assert.strictEqual(sel.isImportant, true);
    assert.strictEqual(sel.isUrgent, false);
    assert.strictEqual(sel.tags, 'home');
  });

  it('buildFilterSelector should support dueBefore filtering', function () {
    const sel = buildFilterSelector({ dueBefore: '2026-12-31' });
    assert.ok(sel.$or, 'Should have $or clause for deadline');
    assert.ok(Array.isArray(sel.$or), '$or should be an array');
    assert.strictEqual(sel.$or.length, 2, 'Should have 2 branches (Date and string)');
  });

  it('buildFilterSelector should return empty selector for no filters', function () {
    const sel = buildFilterSelector({});
    // Empty object except possibly $or if dueBefore was null
    const keys = Object.keys(sel);
    assert.strictEqual(keys.length, 0, 'Should have no filters');
  });

  it('bindArgsWithMemory should inject projectId for tool_tasksByProject', function () {
    const memory = { ids: { projectId: 'proj123' } };
    const args = bindArgsWithMemory('tool_tasksByProject', {}, memory);
    assert.strictEqual(args.projectId, 'proj123');
  });

  it('bindArgsWithMemory should inject projectId for tool_notesByProject', function () {
    const memory = { ids: { projectId: 'proj456' } };
    const args = bindArgsWithMemory('tool_notesByProject', {}, memory);
    assert.strictEqual(args.projectId, 'proj456');
  });

  it('bindArgsWithMemory should inject sessionId for tool_noteLinesBySession', function () {
    const memory = { ids: { sessionId: 'sess789' } };
    const args = bindArgsWithMemory('tool_noteLinesBySession', {}, memory);
    assert.strictEqual(args.sessionId, 'sess789');
  });

  it('bindArgsWithMemory should resolve {var:...} syntax', function () {
    const memory = { ids: { projectId: 'varProj' } };
    const args = bindArgsWithMemory('tool_tasksByProject', { projectId: { var: 'ids.projectId' } }, memory);
    assert.strictEqual(args.projectId, 'varProj');
  });

  it('buildProjectByNameSelector should escape regex chars', function () {
    const sel = buildProjectByNameSelector('Test (Project)');
    assert.ok(sel.name, 'Should have name selector');
    assert.ok(sel.name.$regex, 'Should use regex');
    assert.ok(sel.name.$options === 'i', 'Should be case-insensitive');
  });

  it('buildProjectByNameSelector should return empty for empty name', function () {
    const sel = buildProjectByNameSelector('');
    assert.deepStrictEqual(sel, {}, 'Should return empty object');
  });
});
