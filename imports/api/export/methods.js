import { Meteor } from 'meteor/meteor';
import { requireUserId } from '/imports/api/_shared/auth.js';
import { auditLog } from '/imports/api/_shared/audit.js';

Meteor.methods({
  async 'app.exportAll'() {
    const userId = requireUserId();
    auditLog('data.export', { userId, type: 'json' });
    // Export all collections as arrays — scoped to current user
    const projects = await (await import('/imports/api/projects/collections')).ProjectsCollection.find({ userId }).fetchAsync();
    const tasks = await (await import('/imports/api/tasks/collections')).TasksCollection.find({ userId }).fetchAsync();
    const notes = await (await import('/imports/api/notes/collections')).NotesCollection.find({ userId }).fetchAsync();
    const sessions = await (await import('/imports/api/noteSessions/collections')).NoteSessionsCollection.find({ userId }).fetchAsync();
    const lines = await (await import('/imports/api/noteLines/collections')).NoteLinesCollection.find({ userId }).fetchAsync();
    const alarms = await (await import('/imports/api/alarms/collections')).AlarmsCollection.find({ userId }).fetchAsync();
    return { projects, tasks, notes, sessions, lines, alarms, exportedAt: new Date() };
  }
});
