import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { NoteRevisionsCollection } from './collections';
import { ensureNoteAccess } from './access';
import { NotesCollection } from '/imports/api/notes/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

// Revisions this user may read: the ones stamped with their own notes, the
// ones on notes of a project they belong to, and (for revisions written
// before the owner was stamped) the ones they wrote themselves.
const accessSelector = async (userId) => {
  const projectIds = (await ProjectsCollection.find(
    { memberIds: userId }, { fields: { _id: 1 } }
  ).fetchAsync()).map(p => p._id);
  return {
    $or: [
      { noteUserId: userId, noteProjectId: null },
      { noteProjectId: { $in: projectIds } },
      { noteUserId: { $exists: false }, userId },
    ],
  };
};

Meteor.methods({
  // Full body of one revision. The publication only carries metadata, so the
  // history panel asks for a body only when the user opens or restores one.
  async 'noteRevisions.get'(revisionId) {
    check(revisionId, String);
    ensureLoggedIn(this.userId);
    const revision = await NoteRevisionsCollection.findOneAsync(revisionId);
    if (!revision) throw new Meteor.Error('not-found', 'Revision not found');
    await ensureNoteAccess(revision.noteId, this.userId);
    return revision;
  },

  // Notes that were deleted but still have a history. notes.remove is a hard
  // delete, so these revisions are the only remaining copy of their text.
  // Not a publication: the answer is a diff between two collections, which a
  // cursor cannot express.
  async 'noteRevisions.deletedNotes'() {
    ensureLoggedIn(this.userId);
    const selector = await accessSelector(this.userId);
    const grouped = await NoteRevisionsCollection.rawCollection().aggregate([
      { $match: selector },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$noteId',
          // Title of the most recent revision — i.e. the title the note had
          // just before its last edit. The note itself is gone, so this is the
          // closest name available.
          title: { $first: '$title' },
          lastRevisionId: { $first: '$_id' },
          lastRevisionAt: { $first: '$createdAt' },
          contentLength: { $first: '$contentLength' },
          revisionCount: { $sum: 1 },
        },
      },
    ]).toArray();
    if (grouped.length === 0) return [];

    const noteIds = grouped.map(g => g._id);
    const alive = new Set((await NotesCollection.find(
      { _id: { $in: noteIds } }, { fields: { _id: 1 } }
    ).fetchAsync()).map(n => n._id));

    return grouped
      .filter(g => !alive.has(g._id))
      .map(g => ({
        noteId: g._id,
        title: g.title,
        lastRevisionId: g.lastRevisionId,
        lastRevisionAt: g.lastRevisionAt,
        contentLength: g.contentLength,
        revisionCount: g.revisionCount,
      }))
      .sort((a, b) => new Date(b.lastRevisionAt) - new Date(a.lastRevisionAt));
  },

  // Bring a deleted note back, with its original _id so deep links and its own
  // history stay attached. Defaults to the most recent revision.
  async 'noteRevisions.restoreDeletedNote'(noteId, revisionId = null) {
    check(noteId, String);
    check(revisionId, Match.Maybe(String));
    ensureLoggedIn(this.userId);

    const existing = await NotesCollection.findOneAsync(noteId, { fields: { _id: 1 } });
    if (existing) throw new Meteor.Error('note-exists', 'This note still exists — nothing to restore');

    const target = await ensureNoteAccess(noteId, this.userId);

    const revision = revisionId
      ? await NoteRevisionsCollection.findOneAsync({ _id: revisionId, noteId })
      : await NoteRevisionsCollection.findOneAsync({ noteId }, { sort: { createdAt: -1 } });
    if (!revision) throw new Meteor.Error('not-found', 'Revision not found');

    // Keep the note in its project only if that project is still reachable
    let projectId = null;
    if (target.projectId) {
      const project = await ProjectsCollection.findOneAsync(
        { _id: target.projectId, memberIds: this.userId }, { fields: { _id: 1 } }
      );
      projectId = project ? target.projectId : null;
    }

    const now = new Date();
    const title = revision.title || 'Restored note';
    const content = revision.content || '';
    await NotesCollection.insertAsync({
      _id: noteId,
      title,
      content,
      projectId,
      userId: target.userId || this.userId,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[noteRevisions.restoreDeletedNote] Restored note ${noteId} from revision ${revision._id}`);

    // Same indexing and link detection as notes.insert
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await upsertDocChunks({ kind: 'note', id: noteId, text: `${title} ${content}`.trim(), projectId, userId: this.userId, minChars: 800, maxChars: 1200, overlap: 150, replace: true });
    } catch (e) {
      console.error('[search][noteRevisions.restoreDeletedNote] upsert failed', e);
    }
    const { syncLinksFromNote } = await import('/imports/api/links/autoDetect.js');
    syncLinksFromNote({ noteId, projectId, content, userId: this.userId })
      .catch(e => console.error('[links][noteRevisions.restoreDeletedNote] auto-detect failed', e));

    if (projectId) {
      await ProjectsCollection.updateAsync(projectId, { $set: { updatedAt: new Date() } });
    }
    return noteId;
  },

  // Manual purge only — nothing in the app removes revisions on its own.
  async 'noteRevisions.purge'(noteId) {
    check(noteId, String);
    ensureLoggedIn(this.userId);
    await ensureNoteAccess(noteId, this.userId);
    const removed = await NoteRevisionsCollection.removeAsync({ noteId });
    console.log(`[noteRevisions.purge] Removed ${removed} revision(s) of note ${noteId}`);
    return removed;
  },
});
