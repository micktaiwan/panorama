import { Meteor } from 'meteor/meteor';
import { NotesCollection } from './collections';

Meteor.publish('notes', function publishNotes() {
  return NotesCollection.find();
});


