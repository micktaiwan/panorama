import { Meteor } from 'meteor/meteor';
import { NoteLinesCollection } from './collections';

Meteor.publish('noteLines', function publishNoteLines() {
  return NoteLinesCollection.find();
});


