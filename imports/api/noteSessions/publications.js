import { Meteor } from 'meteor/meteor';
import { NoteSessionsCollection } from './collections';

Meteor.publish('noteSessions', function publishNoteSessions() {
  if (!this.userId) return this.ready();
  return NoteSessionsCollection.find({ userId: this.userId });
});


