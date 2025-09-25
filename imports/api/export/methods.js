import { Meteor } from 'meteor/meteor';

Meteor.methods({
  async 'app.exportAll'() {
    // Export all collections as arrays
    const projects = await (await import('/imports/api/projects/collections')).ProjectsCollection.find({}).fetchAsync();
    const tasks = await (await import('/imports/api/tasks/collections')).TasksCollection.find({}).fetchAsync();
    const notes = await (await import('/imports/api/notes/collections')).NotesCollection.find({}).fetchAsync();
    const sessions = await (await import('/imports/api/noteSessions/collections')).NoteSessionsCollection.find({}).fetchAsync();
    const lines = await (await import('/imports/api/noteLines/collections')).NoteLinesCollection.find({}).fetchAsync();
    const alarms = await (await import('/imports/api/alarms/collections')).AlarmsCollection.find({}).fetchAsync();
    return { projects, tasks, notes, sessions, lines, alarms, exportedAt: new Date() };
  }
});
