import assert from 'assert';
import { Meteor } from 'meteor/meteor';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteRevisionsCollection } from '/imports/api/noteRevisions/collections';
import '/imports/api/notes/methods';
import '/imports/api/noteRevisions/methods';

const USER_ID = 'noteRevisionsTestUser';

// A DDP-backed call (a real client) vs a server-to-server call (MCP): the only
// difference the methods see is the presence of `connection`.
const callAsUi = (method, ...args) =>
  Meteor.server.method_handlers[method].call({ userId: USER_ID, connection: { id: 'ddp-session' } }, ...args);
const callAsMcp = (method, ...args) =>
  Meteor.server.method_handlers[method].call({ userId: USER_ID, connection: null }, ...args);

const createNote = (content) => NotesCollection.insertAsync({
  title: 'revision test note',
  content,
  userId: USER_ID,
  createdAt: new Date(),
});

const revisionsOf = (noteId) =>
  NoteRevisionsCollection.find({ noteId }, { sort: { createdAt: 1 } }).fetchAsync();

describe('note revisions', function () {
  afterEach(async function () {
    await NotesCollection.removeAsync({ userId: USER_ID });
    await NoteRevisionsCollection.removeAsync({ userId: USER_ID });
  });

  it('keeps the previous body on every content change, without deduplicating', async function () {
    const noteId = await createNote('v1');
    await callAsUi('notes.update', noteId, { content: 'v2' });
    await callAsUi('notes.update', noteId, { content: 'v3' });
    await callAsUi('notes.update', noteId, { content: 'v1' });

    const revisions = await revisionsOf(noteId);
    assert.deepStrictEqual(revisions.map(r => r.content), ['v1', 'v2', 'v3']);
    assert.strictEqual((await NotesCollection.findOneAsync(noteId))?.content, 'v1');
  });

  it('records nothing when the body is unchanged or only the title moves', async function () {
    const noteId = await createNote('same body');
    await callAsUi('notes.update', noteId, { content: 'same body' });
    await callAsUi('notes.update', noteId, { title: 'a new title' });

    assert.strictEqual((await revisionsOf(noteId)).length, 0);
  });

  it('marks the source of the write', async function () {
    const noteId = await createNote('v1');
    await callAsUi('notes.update', noteId, { content: 'v2' });
    await callAsMcp('notes.update', noteId, { content: 'v3' });

    assert.deepStrictEqual((await revisionsOf(noteId)).map(r => r.source), ['ui', 'mcp']);
  });

  it('records the replaced body on a successful CAS write and nothing on a failed one', async function () {
    const noteId = await createNote('v1');
    await callAsMcp('notes.updateContentCAS', noteId, 'v2', 'v1');
    const failed = await callAsMcp('notes.updateContentCAS', noteId, 'v3', 'stale expectation');

    assert.strictEqual(failed, 0);
    const revisions = await revisionsOf(noteId);
    assert.deepStrictEqual(revisions.map(r => r.content), ['v1']);
  });

  it('keeps the history readable after the note is hard-deleted', async function () {
    const noteId = await createNote('v1');
    await callAsUi('notes.update', noteId, { content: 'v2' });
    await callAsUi('notes.remove', noteId);

    assert.strictEqual(await NotesCollection.findOneAsync(noteId), undefined);
    // The delete itself appends the final body, which no earlier revision held
    const revisions = await revisionsOf(noteId);
    assert.deepStrictEqual(revisions.map(r => r.content), ['v1', 'v2']);
    const read = await callAsUi('noteRevisions.get', revisions[0]._id);
    assert.strictEqual(read.content, 'v1');

    const deleted = await callAsUi('noteRevisions.deletedNotes');
    const row = deleted.find(d => d.noteId === noteId);
    assert.ok(row, 'the deleted note is listed');
    assert.strictEqual(row.revisionCount, 2);
  });

  it('does not expose another user\'s deleted note', async function () {
    const noteId = await createNote('secret v1');
    await callAsUi('notes.update', noteId, { content: 'secret v2' });
    await callAsUi('notes.remove', noteId);

    const [revision] = await revisionsOf(noteId);
    const asStranger = () => Meteor.server.method_handlers['noteRevisions.get']
      .call({ userId: 'someoneElse', connection: { id: 'x' } }, revision._id);
    await assert.rejects(asStranger, (e) => e.error === 'not-found');

    const strangerList = await Meteor.server.method_handlers['noteRevisions.deletedNotes']
      .call({ userId: 'someoneElse', connection: { id: 'x' } });
    assert.ok(!strangerList.some(d => d.noteId === noteId));
  });

  it('restores a deleted note with its original id and history', async function () {
    const noteId = await createNote('v1');
    await callAsUi('notes.update', noteId, { content: 'v2' });
    await callAsUi('notes.remove', noteId);

    await callAsUi('noteRevisions.restoreDeletedNote', noteId, null);
    const restored = await NotesCollection.findOneAsync(noteId);
    assert.ok(restored, 'the note is back under its original id');
    // The newest revision is the one the delete recorded: the body as deleted
    assert.strictEqual(restored.content, 'v2');
    assert.strictEqual((await revisionsOf(noteId)).length, 2);

    await assert.rejects(
      () => callAsUi('noteRevisions.restoreDeletedNote', noteId, null),
      (e) => e.error === 'note-exists'
    );
  });

  it('purges only on demand, and only the asked note', async function () {
    const kept = await createNote('k1');
    const purged = await createNote('p1');
    await callAsUi('notes.update', kept, { content: 'k2' });
    await callAsUi('notes.update', purged, { content: 'p2' });

    const removed = await callAsUi('noteRevisions.purge', purged);
    assert.strictEqual(removed, 1);
    assert.strictEqual((await revisionsOf(purged)).length, 0);
    assert.strictEqual((await revisionsOf(kept)).length, 1);
  });
});
