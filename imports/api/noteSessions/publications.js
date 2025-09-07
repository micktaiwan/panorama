import { Meteor } from 'meteor/meteor';
import { NoteSessionsCollection } from './collections';

Meteor.publish('noteSessions', function publishNoteSessions() {
  return NoteSessionsCollection.find();
});


