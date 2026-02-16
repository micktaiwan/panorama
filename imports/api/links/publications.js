import { Meteor } from 'meteor/meteor';
import { LinksCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

Meteor.publish('links', function () {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return LinksCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    });
  });
});

Meteor.publish('links.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  if (!projectId) return this.ready();
  this.autorun(async () => {
    const project = await ProjectsCollection.findOneAsync(
      { _id: projectId, memberIds: this.userId }, { fields: { _id: 1 } }
    );
    if (!project) return this.ready();
    return LinksCollection.find({ projectId });
  });
});
