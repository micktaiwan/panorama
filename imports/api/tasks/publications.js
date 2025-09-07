import { Meteor } from 'meteor/meteor';
import { TasksCollection } from './collections';

Meteor.publish('tasks', function publishTasks() {
  return TasksCollection.find();
});


