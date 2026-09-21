import { NoteRevisionsCollection } from './collections';

// Where a write came from. Derived from the method invocation: a DDP session
// means a real client (the Notes UI), no session means a server-to-server call
// — today only the MCP handlers call note writes that way.
export const resolveWriteSource = (invocation) => (invocation?.connection ? 'ui' : 'mcp');

/**
 * Append a revision holding the note's state BEFORE the write about to happen.
 *
 * Called with the note document as it currently stands in the database. No
 * deduplication, no time window, no retention cap: callers decide whether the
 * content actually changed, and every change is kept forever.
 *
 * `userId` is who performed the write, which on a shared project note is not
 * necessarily the note's owner. The note's own owner and project are copied
 * alongside so that access can still be resolved after the note itself is
 * deleted — notes.remove is a hard delete, and the revisions then hold the
 * only remaining copy of the text.
 *
 * @param {Object} params
 * @param {Object} params.note - the note document, before the write
 * @param {string} params.userId - the user performing the write
 * @param {'ui'|'mcp'} params.source - where the write came from
 */
export const recordNoteRevision = async ({ note, userId, source }) => {
  const content = typeof note?.content === 'string' ? note.content : '';
  return NoteRevisionsCollection.insertAsync({
    noteId: note._id,
    userId,
    noteUserId: note.userId || null,
    noteProjectId: note.projectId || null,
    content,
    contentLength: content.length,
    title: typeof note?.title === 'string' ? note.title : '',
    source,
    createdAt: new Date(),
  });
};
