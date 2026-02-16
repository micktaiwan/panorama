import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

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
    });
  });
});

// Claude sessions are personal — stays userId-only
Meteor.publish('notes.byClaudeProject', function publishNotesByClaudeProject(claudeProjectId) {
  if (!this.userId) return this.ready();
  check(claudeProjectId, String);
  return NotesCollection.find({ userId: this.userId, claudeProjectId }, { sort: { createdAt: 1 } });
});
