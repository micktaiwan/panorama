import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';

Meteor.publish('notes', function publishNotes() {
  if (!this.userId) return this.ready();
  return NotesCollection.find({ userId: this.userId });
});

Meteor.publish('notes.byClaudeProject', function publishNotesByClaudeProject(claudeProjectId) {
  if (!this.userId) return this.ready();
  check(claudeProjectId, String);
  return NotesCollection.find({ claudeProjectId, userId: this.userId }, { sort: { createdAt: 1 } });
});


