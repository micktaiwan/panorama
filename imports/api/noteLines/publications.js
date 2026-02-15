import { Meteor } from 'meteor/meteor';
import { NoteLinesCollection } from './collections';

Meteor.publish('noteLines', function publishNoteLines() {
  if (!this.userId) return this.ready();
  return NoteLinesCollection.find({ userId: this.userId });
});


