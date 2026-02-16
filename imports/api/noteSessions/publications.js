import { Meteor } from 'meteor/meteor';
import { NoteSessionsCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

Meteor.publish('noteSessions', function publishNoteSessions() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return NoteSessionsCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    });
  });
});
