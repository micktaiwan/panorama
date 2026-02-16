import assert from 'assert';
import { Meteor } from 'meteor/meteor';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { NotesCollection } from '/imports/api/notes/collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { NoteLinesCollection } from '/imports/api/noteLines/collections';
import { LinksCollection } from '/imports/api/links/collections';
import { FilesCollection } from '/imports/api/files/collections';

if (Meteor.isServer) {
  // Import methods so they're registered
  import '/imports/api/projects/methods';
  import '/imports/api/tasks/methods';
  import '/imports/api/notes/methods';
  import '/imports/api/noteSessions/methods';
  import '/imports/api/noteLines/methods';
  import '/imports/api/links/methods';

  describe('Project Sharing', function () {
    const ownerUserId = 'owner-user-id';
    const memberUserId = 'member-user-id';
    const outsiderUserId = 'outsider-user-id';
    const memberEmail = 'member@test.com';
    let projectId;

    beforeEach(async function () {
      // Clean up
      await ProjectsCollection.removeAsync({});
      await TasksCollection.removeAsync({});
      await NotesCollection.removeAsync({});
      await NoteSessionsCollection.removeAsync({});
      await NoteLinesCollection.removeAsync({});
      await LinksCollection.removeAsync({});
      await FilesCollection.removeAsync({});

      // Create a test user for the member
      await Meteor.users.removeAsync({ _id: memberUserId });
      await Meteor.users.insertAsync({
        _id: memberUserId,
        emails: [{ address: memberEmail, verified: true }],
        username: 'testmember',
      });

      // Create a project with owner
      projectId = await ProjectsCollection.insertAsync({
        name: 'Test Project',
        userId: ownerUserId,
        memberIds: [ownerUserId],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    afterEach(async function () {
      await Meteor.users.removeAsync({ _id: memberUserId });
    });

    describe('ensureProjectAccess', function () {
      it('should allow access for a member', async function () {
        const { ensureProjectAccess } = await import('/imports/api/_shared/auth');
        const project = await ensureProjectAccess(projectId, ownerUserId);
        assert.ok(project);
        assert.strictEqual(project._id, projectId);
      });

      it('should deny access for a non-member', async function () {
        const { ensureProjectAccess } = await import('/imports/api/_shared/auth');
        try {
          await ensureProjectAccess(projectId, outsiderUserId);
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'not-found');
        }
      });

      it('should allow access after adding a member', async function () {
        const { ensureProjectAccess } = await import('/imports/api/_shared/auth');
        await ProjectsCollection.updateAsync(projectId, { $addToSet: { memberIds: memberUserId } });
        const project = await ensureProjectAccess(projectId, memberUserId);
        assert.ok(project);
      });
    });

    describe('projects.addMember', function () {
      it('should add a member by email', async function () {
        const addMember = Meteor.server.method_handlers['projects.addMember'];
        const ctx = { userId: ownerUserId };
        const result = await addMember.call(ctx, projectId, memberEmail);
        assert.strictEqual(result, memberUserId);

        const project = await ProjectsCollection.findOneAsync(projectId);
        assert.ok(project.memberIds.includes(memberUserId));
      });

      it('should fail if email not found', async function () {
        const addMember = Meteor.server.method_handlers['projects.addMember'];
        const ctx = { userId: ownerUserId };
        try {
          await addMember.call(ctx, projectId, 'unknown@test.com');
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'user-not-found');
        }
      });

      it('should fail if caller is not owner', async function () {
        const addMember = Meteor.server.method_handlers['projects.addMember'];
        const ctx = { userId: memberUserId };
        try {
          await addMember.call(ctx, projectId, memberEmail);
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'not-found');
        }
      });
    });

    describe('projects.removeMember', function () {
      beforeEach(async function () {
        await ProjectsCollection.updateAsync(projectId, { $addToSet: { memberIds: memberUserId } });
      });

      it('should remove a member', async function () {
        const removeMember = Meteor.server.method_handlers['projects.removeMember'];
        const ctx = { userId: ownerUserId };
        await removeMember.call(ctx, projectId, memberUserId);

        const project = await ProjectsCollection.findOneAsync(projectId);
        assert.ok(!project.memberIds.includes(memberUserId));
      });

      it('should fail if trying to remove the owner', async function () {
        const removeMember = Meteor.server.method_handlers['projects.removeMember'];
        const ctx = { userId: ownerUserId };
        try {
          await removeMember.call(ctx, projectId, ownerUserId);
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'cannot-remove-owner');
        }
      });
    });

    describe('Child method access via membership', function () {
      let taskId;

      beforeEach(async function () {
        // Add member to project
        await ProjectsCollection.updateAsync(projectId, { $addToSet: { memberIds: memberUserId } });
        // Create a task in the project (as owner)
        taskId = await TasksCollection.insertAsync({
          title: 'Shared task',
          projectId,
          userId: ownerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      it('should allow member to update a task in shared project', async function () {
        const update = Meteor.server.method_handlers['tasks.update'];
        const ctx = { userId: memberUserId };
        await update.call(ctx, taskId, { title: 'Updated by member' });
        const task = await TasksCollection.findOneAsync(taskId);
        assert.strictEqual(task.title, 'Updated by member');
      });

      it('should deny outsider from updating a task in shared project', async function () {
        const update = Meteor.server.method_handlers['tasks.update'];
        const ctx = { userId: outsiderUserId };
        try {
          await update.call(ctx, taskId, { title: 'Hacked' });
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'not-found');
        }
      });

      it('should allow member to create a task in shared project', async function () {
        const insert = Meteor.server.method_handlers['tasks.insert'];
        const ctx = { userId: memberUserId };
        const newId = await insert.call(ctx, { title: 'Member task', projectId });
        assert.ok(newId);
        const task = await TasksCollection.findOneAsync(newId);
        assert.strictEqual(task.userId, memberUserId);
        assert.strictEqual(task.projectId, projectId);
      });
    });

    describe('Cascade delete', function () {
      beforeEach(async function () {
        // Add member and create docs from both users
        await ProjectsCollection.updateAsync(projectId, { $addToSet: { memberIds: memberUserId } });

        await TasksCollection.insertAsync({ title: 'Owner task', projectId, userId: ownerUserId, createdAt: new Date() });
        await TasksCollection.insertAsync({ title: 'Member task', projectId, userId: memberUserId, createdAt: new Date() });
        await NotesCollection.insertAsync({ title: 'Owner note', projectId, userId: ownerUserId, createdAt: new Date() });
        await LinksCollection.insertAsync({ name: 'Link', url: 'https://test.com', projectId, userId: ownerUserId, createdAt: new Date() });
        await FilesCollection.insertAsync({ name: 'File', projectId, userId: ownerUserId, storedFileName: 'test__abc__test.txt', createdAt: new Date() });
      });

      it('should delete all docs when project is removed', async function () {
        const remove = Meteor.server.method_handlers['projects.remove'];
        const ctx = { userId: ownerUserId };
        await remove.call(ctx, projectId);

        assert.strictEqual(await TasksCollection.find({ projectId }).countAsync(), 0);
        assert.strictEqual(await NotesCollection.find({ projectId }).countAsync(), 0);
        assert.strictEqual(await LinksCollection.find({ projectId }).countAsync(), 0);
        assert.strictEqual(await FilesCollection.find({ projectId }).countAsync(), 0);
        assert.strictEqual(await ProjectsCollection.find({ _id: projectId }).countAsync(), 0);
      });
    });

    describe('Orphan docs (no projectId)', function () {
      it('should keep orphan docs private to their owner', async function () {
        const orphanTaskId = await TasksCollection.insertAsync({
          title: 'Private task',
          userId: ownerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const update = Meteor.server.method_handlers['tasks.update'];
        // Owner can access
        await update.call({ userId: ownerUserId }, orphanTaskId, { title: 'Still private' });
        const task = await TasksCollection.findOneAsync(orphanTaskId);
        assert.strictEqual(task.title, 'Still private');

        // Other user cannot access
        try {
          await update.call({ userId: memberUserId }, orphanTaskId, { title: 'Hacked' });
          assert.fail('Should have thrown');
        } catch (e) {
          assert.strictEqual(e.error, 'not-found');
        }
      });
    });

    describe('memberIds on project insert', function () {
      it('should include userId in memberIds on insert', async function () {
        const insert = Meteor.server.method_handlers['projects.insert'];
        const ctx = { userId: ownerUserId };
        const newId = await insert.call(ctx, { name: 'New project' });
        const project = await ProjectsCollection.findOneAsync(newId);
        assert.ok(Array.isArray(project.memberIds));
        assert.ok(project.memberIds.includes(ownerUserId));
      });
    });
  });
}
