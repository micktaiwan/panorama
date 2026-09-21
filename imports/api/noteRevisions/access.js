import { Meteor } from 'meteor/meteor';
import { NotesCollection } from '/imports/api/notes/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { NoteRevisionsCollection } from './collections';

const isProjectMember = async (projectId, userId) => {
  const project = await ProjectsCollection.findOneAsync({ _id: projectId, memberIds: userId });
  return !!project;
};

/**
 * Revisions inherit the access rules of the note they belong to: a project
 * note is readable by the project members, a standalone note by its owner.
 *
 * When the note no longer exists the rule is applied to the owner and project
 * copied onto the revisions themselves. notes.remove is a hard delete, so the
 * revisions are then the only remaining copy of the text — refusing access
 * there would destroy it in practice, which is exactly what this history
 * exists to prevent.
 *
 * Throws 'not-found' when the user may not see it — the same error as a
 * missing note, so nothing leaks about other users' notes.
 */
export const ensureNoteAccess = async (noteId, userId) => {
  const note = await NotesCollection.findOneAsync(noteId, { fields: { userId: 1, projectId: 1, title: 1 } });
  if (note) {
    if (note.projectId) {
      if (!(await isProjectMember(note.projectId, userId))) throw new Meteor.Error('not-found', 'Note not found');
    } else if (note.userId !== userId) {
      throw new Meteor.Error('not-found', 'Note not found');
    }
    return note;
  }

  // Deleted note: fall back to the ownership stamped on its revisions. Read
  // the oldest one — every revision of a note carries the same stamp, and the
  // oldest is the one least likely to be missing it.
  const stamp = await NoteRevisionsCollection.findOneAsync(
    { noteId },
    { sort: { createdAt: 1 }, fields: { noteUserId: 1, noteProjectId: 1, userId: 1, title: 1 } }
  );
  if (!stamp) throw new Meteor.Error('not-found', 'Note not found');

  if (stamp.noteProjectId) {
    if (!(await isProjectMember(stamp.noteProjectId, userId))) throw new Meteor.Error('not-found', 'Note not found');
  } else {
    // noteUserId is absent on revisions written before it was stored; the
    // writer is then the only ownership signal available.
    const owner = stamp.noteUserId || stamp.userId;
    if (owner !== userId) throw new Meteor.Error('not-found', 'Note not found');
  }

  return { _id: noteId, deleted: true, userId: stamp.noteUserId || stamp.userId, projectId: stamp.noteProjectId || null, title: stamp.title || '' };
};
