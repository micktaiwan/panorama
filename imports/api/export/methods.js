import { Meteor } from 'meteor/meteor';
import { ensureLoggedIn } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'app.exportAll'() {
    ensureLoggedIn(this.userId);
    const userFilter = { userId: this.userId };
    // Export remote collections filtered by userId
    const projects = await (await import('/imports/api/projects/collections')).ProjectsCollection.find(userFilter).fetchAsync();
    const tasks = await (await import('/imports/api/tasks/collections')).TasksCollection.find(userFilter).fetchAsync();
    const notes = await (await import('/imports/api/notes/collections')).NotesCollection.find(userFilter).fetchAsync();
    const sessions = await (await import('/imports/api/noteSessions/collections')).NoteSessionsCollection.find(userFilter).fetchAsync();
    const lines = await (await import('/imports/api/noteLines/collections')).NoteLinesCollection.find(userFilter).fetchAsync();
    // Alarms are local-only, export all
    const alarms = await (await import('/imports/api/alarms/collections')).AlarmsCollection.find({}).fetchAsync();
    return { projects, tasks, notes, sessions, lines, alarms, exportedAt: new Date() };
  }
});
