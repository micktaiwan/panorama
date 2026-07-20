import assert from 'assert';
import { Meteor } from 'meteor/meteor';
import { TOOL_HANDLERS } from '/imports/api/tools/handlers';
import { NotesCollection } from '/imports/api/notes/collections';
import { mcpRequestContext } from '/imports/api/mcp/server/requestContext';
// Register notes.* methods (unit test mode does not load server/main.js)
import '/imports/api/notes/methods';

const USER_ID = 'editNoteTestUser01';
const OTHER_USER_ID = 'editNoteOtherUser1';

// Run a handler inside an MCP request context (as routes.js does for real calls)
const asUser = (fn) => mcpRequestContext.run({ userId: USER_ID }, fn);

const createNote = (content) => NotesCollection.insertAsync({
  title: 'tool_editNote test note',
  content,
  userId: USER_ID,
  createdAt: new Date()
});

const getContent = async (noteId) => (await NotesCollection.findOneAsync(noteId))?.content;

describe('tool_editNote', function () {
  afterEach(async function () {
    await NotesCollection.removeAsync({ userId: USER_ID });
  });

  it('replaces a unique occurrence and leaves the rest of the body verbatim', async function () {
    const noteId = await createNote('# Title\n\nstatus: in progress\n\nfooter line');
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: 'status: in progress', newText: 'status: done' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.data?.edited, true);
    assert.strictEqual(parsed.data?.casRetries, 0);
    assert.strictEqual(await getContent(noteId), '# Title\n\nstatus: done\n\nfooter line');
  });

  it('deletes the anchor when newText is empty', async function () {
    const noteId = await createNote('keep A\nDELETE ME\nkeep B');
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: '\nDELETE ME', newText: '' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.data?.edited, true);
    assert.strictEqual(await getContent(noteId), 'keep A\nkeep B');
  });

  it('errors with OLD_TEXT_NOT_FOUND and writes nothing when the anchor is absent', async function () {
    const original = 'some body without the anchor';
    const noteId = await createNote(original);
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: 'not in the note', newText: 'whatever' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error?.code, 'OLD_TEXT_NOT_FOUND');
    assert.strictEqual(await getContent(noteId), original);
  });

  it('errors with AMBIGUOUS_MATCH and writes nothing when the anchor occurs twice', async function () {
    const original = 'alpha TARGET beta TARGET gamma';
    const noteId = await createNote(original);
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: 'TARGET', newText: 'X' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error?.code, 'AMBIGUOUS_MATCH');
    assert.strictEqual(await getContent(noteId), original);
  });

  it('returns skipped:true when the edit was already applied (idempotency)', async function () {
    const noteId = await createNote('status: done');
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: 'status: in progress', newText: 'status: done' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.data?.skipped, true);
    assert.strictEqual(await getContent(noteId), 'status: done');
  });

  it('rejects identical oldText and newText', async function () {
    const noteId = await createNote('same text');
    const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
      { noteId, oldText: 'same text', newText: 'same text' }, {}
    ));
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.error?.code, 'NO_OP');
  });

  it('returns NOT_FOUND for a note owned by another user', async function () {
    const noteId = await NotesCollection.insertAsync({
      title: 'other user note', content: 'secret TARGET', userId: OTHER_USER_ID, createdAt: new Date()
    });
    try {
      const result = await asUser(() => TOOL_HANDLERS.tool_editNote(
        { noteId, oldText: 'TARGET', newText: 'X' }, {}
      ));
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.error?.code, 'NOT_FOUND');
      assert.strictEqual(await getContent(noteId), 'secret TARGET');
    } finally {
      await NotesCollection.removeAsync(noteId);
    }
  });

  it('fails with note-locked when the note is locked by another user, content untouched', async function () {
    const noteId = await createNote('locked TARGET body');
    await NotesCollection.updateAsync(noteId, { $set: { lockedBy: OTHER_USER_ID, lockedAt: new Date() } });
    await assert.rejects(
      asUser(() => TOOL_HANDLERS.tool_editNote({ noteId, oldText: 'TARGET', newText: 'X' }, {})),
      (err) => err?.error === 'note-locked'
    );
    assert.strictEqual(await getContent(noteId), 'locked TARGET body');
  });
});

describe('notes.updateContentCAS', function () {
  const callAs = (userId, ...args) =>
    Meteor.server.method_handlers['notes.updateContentCAS'].call({ userId }, ...args);

  afterEach(async function () {
    await NotesCollection.removeAsync({ userId: USER_ID });
  });

  it('applies the write when expectedContent matches, and bumps updatedAt', async function () {
    const noteId = await NotesCollection.insertAsync({
      title: 'cas test', content: 'v1', userId: USER_ID, createdAt: new Date()
    });
    const res = await callAs(USER_ID, noteId, 'v2', 'v1');
    assert.strictEqual(res, 1);
    const note = await NotesCollection.findOneAsync(noteId);
    assert.strictEqual(note.content, 'v2');
    assert.ok(note.updatedAt instanceof Date);
  });

  it('returns 0 and writes nothing when expectedContent is stale (concurrent write)', async function () {
    const noteId = await NotesCollection.insertAsync({
      title: 'cas test', content: 'v2-written-by-someone-else', userId: USER_ID, createdAt: new Date()
    });
    const res = await callAs(USER_ID, noteId, 'v3', 'v1-stale-read');
    assert.strictEqual(res, 0);
    assert.strictEqual(await getContent(noteId), 'v2-written-by-someone-else');
  });

  it('matches an empty expectedContent against a missing content field', async function () {
    const noteId = await NotesCollection.insertAsync({
      title: 'cas test no content', userId: USER_ID, createdAt: new Date()
    });
    const res = await callAs(USER_ID, noteId, 'first body', '');
    assert.strictEqual(res, 1);
    assert.strictEqual(await getContent(noteId), 'first body');
  });

  it('releases the caller\'s own lock after a successful write', async function () {
    const noteId = await NotesCollection.insertAsync({
      title: 'cas lock test', content: 'v1', userId: USER_ID, createdAt: new Date(),
      lockedBy: USER_ID, lockedAt: new Date()
    });
    const res = await callAs(USER_ID, noteId, 'v2', 'v1');
    assert.strictEqual(res, 1);
    // Lock release is fire-and-forget — poll briefly for it
    for (let i = 0; i < 50; i++) {
      const note = await NotesCollection.findOneAsync(noteId);
      if (!note.lockedBy) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('lockedBy was not released after successful CAS write');
  });
});
