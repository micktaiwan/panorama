import { Meteor } from 'meteor/meteor';
import { NoteLinesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

Meteor.publish('noteLines', function publishNoteLines() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return NoteLinesCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    });
  });
});
