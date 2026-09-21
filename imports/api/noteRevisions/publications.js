import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NoteRevisionsCollection } from './collections';
import { ensureNoteAccess } from './access';

// Metadata only: revision bodies are as heavy as the notes themselves, and the
// history panel lists them before it needs any of them. Bodies are fetched one
// at a time through noteRevisions.get.
const REVISION_META_FIELDS = {
  noteId: 1,
  userId: 1,
  title: 1,
  source: 1,
  contentLength: 1,
  createdAt: 1,
};

Meteor.publish('noteRevisions.byNote', async function publishNoteRevisions(noteId) {
  check(noteId, String);
  if (!this.userId) return this.ready();
  try {
    await ensureNoteAccess(noteId, this.userId);
  } catch (e) {
    console.warn('[noteRevisions.byNote] access denied', noteId, e?.error);
    return this.ready();
  }
  return NoteRevisionsCollection.find(
    { noteId },
    { fields: REVISION_META_FIELDS, sort: { createdAt: -1 } }
  );
});
