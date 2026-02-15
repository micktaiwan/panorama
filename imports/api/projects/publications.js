import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from './collections';

Meteor.publish('projects', function publishProjects() {
  if (!this.userId) return this.ready();
  return ProjectsCollection.find({ userId: this.userId });
});


