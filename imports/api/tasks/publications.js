import { Meteor } from 'meteor/meteor';
import { TasksCollection } from './collections';

Meteor.publish('tasks', function publishTasks() {
  return TasksCollection.find();
});

// Minimal publication for UserLog linking UI
Meteor.publish('tasks.userLogLinks', function publishTaskLinks() {
  return TasksCollection.find(
    { 'source.kind': 'userLog' },
    { fields: { 'source.kind': 1, 'source.logEntryIds': 1, projectId: 1 } }
  );
});

// Focused publications for Calendar page
Meteor.publish('tasks.calendar.open', function publishTasksForCalendarOpen(includeIds = [], excludeIds = []) {
  const include = Array.isArray(includeIds) ? includeIds.map(String).filter(Boolean) : [];
  const exclude = Array.isArray(excludeIds) ? excludeIds.map(String).filter(Boolean) : [];
  const projectSel = include.length > 0
    ? { projectId: { $in: include } }
    : (exclude.length > 0 ? { projectId: { $nin: exclude } } : {});
  const openSelector = {
    $and: [
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

// 2) Scheduled tasks within the upcoming 7 days
Meteor.publish('tasks.calendar.scheduled', function publishTasksForCalendarScheduled(includeIds = [], excludeIds = []) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const horizon = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000);
  const include = Array.isArray(includeIds) ? includeIds.map(String).filter(Boolean) : [];
  const exclude = Array.isArray(excludeIds) ? excludeIds.map(String).filter(Boolean) : [];
  const projectSel = include.length > 0
    ? { projectId: { $in: include } }
    : (exclude.length > 0 ? { projectId: { $nin: exclude } } : {});
  const schedSelector = { $and: [ { scheduledAt: { $gte: startOfDay, $lt: horizon } }, projectSel ] };
  const schedOptions = {
    fields: {
      title: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1,
      projectId: 1, createdAt: 1, scheduledAt: 1, scheduledDurationMin: 1
    }
  };
  return TasksCollection.find(schedSelector, schedOptions);
});

// 3) Open tasks for calendar suggestions (no project filters)
Meteor.publish('tasks.calendar.open.unfiltered', function publishTasksForCalendarOpenUnfiltered() {
  const openSelector = {
    $and: [
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
