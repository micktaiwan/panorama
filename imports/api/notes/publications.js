import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';

Meteor.publish('notes', function publishNotes() {
  return NotesCollection.find();
});

Meteor.publish('notes.byClaudeProject', function publishNotesByClaudeProject(claudeProjectId) {
  check(claudeProjectId, String);
  return NotesCollection.find({ claudeProjectId }, { sort: { createdAt: 1 } });
});


