import { Meteor } from 'meteor/meteor';
import { FilesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

Meteor.publish('files', function () {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return FilesCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    });
  });
});

Meteor.publish('files.byProject', function (projectId) {
  if (!this.userId) return this.ready();
  const pid = typeof projectId === 'string' ? projectId : '__none__';
  // Orphan files (projectId === '__none__') are private — use userId filter
  if (pid === '__none__') {
    return FilesCollection.find({ userId: this.userId, projectId: '__none__' });
  }
  this.autorun(async () => {
    const project = await ProjectsCollection.findOneAsync(
      { _id: pid, memberIds: this.userId }, { fields: { _id: 1 } }
    );
    if (!project) return this.ready();
    return FilesCollection.find({ projectId: pid });
  });
});
