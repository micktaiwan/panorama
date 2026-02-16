import { Meteor } from 'meteor/meteor';
import { TasksCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

Meteor.publish('tasks', function publishTasks() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return TasksCollection.find({
      $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ]
    });
  });
});

// Minimal publication for UserLog linking UI
Meteor.publish('tasks.userLogLinks', function publishTaskLinks() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    return TasksCollection.find(
      {
        'source.kind': 'userLog',
        $or: [
          { userId: this.userId },
          { projectId: { $in: projectIds } },
        ]
      },
      { fields: { 'source.kind': 1, 'source.logEntryIds': 1, projectId: 1 } }
    );
  });
});

// Focused publications for Calendar page
Meteor.publish('tasks.calendar.open', function publishTasksForCalendarOpen(includeIds = [], excludeIds = []) {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    const include = Array.isArray(includeIds) ? includeIds.map(String).filter(Boolean) : [];
    const exclude = Array.isArray(excludeIds) ? excludeIds.map(String).filter(Boolean) : [];
    const projectSel = include.length > 0
      ? { projectId: { $in: include } }
      : (exclude.length > 0 ? { projectId: { $nin: exclude } } : {});
    const openSelector = {
      $and: [
        { $or: [
          { userId: this.userId },
          { projectId: { $in: projectIds } },
        ] },
        { $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ] },
        { $or: [ { scheduledAt: { $exists: false } }, { scheduledAt: null } ] },
        projectSel
      ]
    };
    const openOptions = {
      sort: { isUrgent: -1, isImportant: -1, deadline: 1, createdAt: 1 },
      limit: 50,
      fields: {
        title: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1,
        projectId: 1, createdAt: 1, scheduledAt: 1, scheduledDurationMin: 1
      }
    };
    return TasksCollection.find(openSelector, openOptions);
  });
});

// 2) Scheduled tasks within the upcoming 7 days
Meteor.publish('tasks.calendar.scheduled', function publishTasksForCalendarScheduled(includeIds = [], excludeIds = []) {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const horizon = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000);
    const include = Array.isArray(includeIds) ? includeIds.map(String).filter(Boolean) : [];
    const exclude = Array.isArray(excludeIds) ? excludeIds.map(String).filter(Boolean) : [];
    const projectSel = include.length > 0
      ? { projectId: { $in: include } }
      : (exclude.length > 0 ? { projectId: { $nin: exclude } } : {});
    const schedSelector = { $and: [
      { $or: [
        { userId: this.userId },
        { projectId: { $in: projectIds } },
      ] },
      { scheduledAt: { $gte: startOfDay, $lt: horizon } },
      projectSel
    ] };
    const schedOptions = {
      fields: {
        title: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1,
        projectId: 1, createdAt: 1, scheduledAt: 1, scheduledDurationMin: 1
      }
    };
    return TasksCollection.find(schedSelector, schedOptions);
  });
});

// 3) Open tasks for calendar suggestions (no project filters)
Meteor.publish('tasks.calendar.open.unfiltered', function publishTasksForCalendarOpenUnfiltered() {
  if (!this.userId) return this.ready();
  this.autorun(async () => {
    const projectIds = (await ProjectsCollection.find(
      { memberIds: this.userId }, { fields: { _id: 1 } }
    ).fetchAsync()).map(p => p._id);
    const openSelector = {
      $and: [
        { $or: [
          { userId: this.userId },
          { projectId: { $in: projectIds } },
        ] },
        { $or: [ { status: { $exists: false } }, { status: { $nin: ['done','cancelled'] } } ] },
        { $or: [ { scheduledAt: { $exists: false } }, { scheduledAt: null } ] }
      ]
    };
    const openOptions = {
      sort: { isUrgent: -1, isImportant: -1, deadline: 1, createdAt: 1 },
      limit: 50,
      fields: {
        title: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1,
        projectId: 1, createdAt: 1, scheduledAt: 1, scheduledDurationMin: 1
      }
    };
    return TasksCollection.find(openSelector, openOptions);
  });
});
