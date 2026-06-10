import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

// Meta only: note contents are heavy and only needed for open notes —
// they are published on demand via notes.content
const NOTE_META_FIELDS = {
  title: 1,
  projectId: 1,
  claudeProjectId: 1,
  userId: 1,
  kind: 1,
  createdAt: 1,
  updatedAt: 1,
  lockedBy: 1,
  lockedAt: 1,
};

const MAX_CONTENT_NOTES = 100;

Meteor.publish('notes', function publishNotes() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return NotesCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    }, { fields: NOTE_META_FIELDS });
  });
});

// Full docs (including content) for explicitly requested notes (open tabs).
// Same access model as 'notes'; the merge box combines both publications.
Meteor.publish('notes.content', function publishNotesContent(noteIds) {
  check(noteIds, [String]);
  if (!this.userId) return this.ready();
  const ids = noteIds.slice(0, MAX_CONTENT_NOTES);
  if (ids.length === 0) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return NotesCollection.find({
      _id: { $in: ids },
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ],
    });
  });
});

// Claude sessions are personal — stays userId-only
Meteor.publish('notes.byClaudeProject', function publishNotesByClaudeProject(claudeProjectId) {
  if (!this.userId) return this.ready();
  check(claudeProjectId, String);
  return NotesCollection.find({ userId: this.userId, claudeProjectId }, { sort: { createdAt: 1 } });
});
