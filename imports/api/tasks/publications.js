import { Meteor } from 'meteor/meteor';
import { TasksCollection } from './collections';

Meteor.publish('tasks', function publishTasks() {
  return TasksCollection.find();
});

// Minimal publication for UserLog linking UI
Meteor.publish('tasks.userLogLinks', function publishTaskLinks() {
  return TasksCollection.find(
    { 'source.kind': 'userLog' },
    { fields: { 'source.logEntryIds': 1, projectId: 1 } }
  );
});


