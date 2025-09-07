import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from './collections';

Meteor.publish('projects', function publishProjects() {
  return ProjectsCollection.find();
});


