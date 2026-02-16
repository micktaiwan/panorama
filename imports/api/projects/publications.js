import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from './collections';

Meteor.publish('projects', function publishProjects() {
  if (!this.userId) return this.ready();
  return ProjectsCollection.find({ memberIds: this.userId });
});

// Publish basic info of project members (for the Members UI section)
Meteor.publish('projectMembers', function publishProjectMembers(projectId) {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const project = await ProjectsCollection.findOneAsync(
      { _id: projectId, memberIds: this.userId },
      { fields: { memberIds: 1 } }
    );
    if (!project) return this.ready();
    return Meteor.users.find(
      { _id: { $in: project.memberIds } },
      { fields: { emails: 1, username: 1, profile: 1 } }
    );
  });
});
