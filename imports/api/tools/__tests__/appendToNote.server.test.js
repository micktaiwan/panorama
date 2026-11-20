import assert from 'assert';
import { TOOL_HANDLERS } from '/imports/api/tools/handlers';
import { NotesCollection } from '/imports/api/notes/collections';
import { mcpRequestContext } from '/imports/api/mcp/server/requestContext';
import '/imports/api/notes/methods';

const USER_ID = 'appendNoteTestUser1';
const asUser = (fn) => mcpRequestContext.run({ userId: USER_ID }, fn);
const createNote = (content) => NotesCollection.insertAsync({
  title: 'tool_appendToNote test note',
  content,
  userId: USER_ID,
  createdAt: new Date()
});
const getContent = async (noteId) => (await NotesCollection.findOneAsync(noteId))?.content;
const append = async (args) => JSON.parse((await asUser(() => TOOL_HANDLERS.tool_appendToNote(args, {}))).output);

describe('tool_appendToNote reported position', function () {
  afterEach(async function () {
    await NotesCollection.removeAsync({ userId: USER_ID });
  });

  it('reports "afterMarker" (not "bottom") when afterMarker places the block', async function () {
    const noteId = await createNote('# Title\n\nold section');
    const parsed = await append({ noteId, afterMarker: '# Title', block: 'NEW' });
    assert.strictEqual(parsed.data?.position, 'afterMarker');
    assert.strictEqual(await getContent(noteId), '# Title\n\nNEW\n\nold section');
  });

  it('reports "bottom" and "top" for the plain modes', async function () {
    const noteId = await createNote('body');
    assert.strictEqual((await append({ noteId, block: 'B' })).data?.position, 'bottom');
    assert.strictEqual((await append({ noteId, block: 'T', position: 'top' })).data?.position, 'top');
    assert.strictEqual(await getContent(noteId), 'T\n\nbody\n\nB');
  });
});
