import { Mongo } from 'meteor/mongo';

// NOTE: note_lines belong to a NoteSession (NoteSessionsCollection), NOT to a
// standalone Note (NotesCollection). Each line carries a `sessionId` and inherits
// its `projectId` from the parent session. These are two unrelated models:
//   - NotesCollection      -> standalone notes with a single monolithic `content` field
//   - NoteSessions + Lines -> session-based, line-by-line note taking
// Do not treat note_lines as the line decomposition of a Note: editing a standalone
// note must go through tool_updateNote (full-content replace), there is no per-line path.
export const NoteLinesCollection = new Mongo.Collection('note_lines');
