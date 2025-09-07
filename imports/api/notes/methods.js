import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

// Normalize short text fields
const sanitizeNoteDoc = (input) => {
  const out = { ...input };
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (typeof out.content === 'string') out.content = out.content; // keep content as-is (no trim)
  return out;
};

Meteor.methods({
  async 'notes.insert'(doc) {
    check(doc, Object);
    const sanitized = sanitizeNoteDoc(doc);
    const _id = await NotesCollection.insertAsync({ ...sanitized, createdAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'note', id: _id, text: `${sanitized.title || ''} ${sanitized.content || ''}`.trim(), projectId: sanitized.projectId || null });
    } catch (e) { console.error('[search][notes.insert] upsert failed', e); }
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    return _id;
  },
  async 'notes.update'(noteId, modifier) {
    check(noteId, String);
    check(modifier, Object);
    const note = await NotesCollection.findOneAsync(noteId);
    const sanitized = sanitizeNoteDoc(modifier);
    const res = await NotesCollection.updateAsync(noteId, { $set: { ...sanitized, updatedAt: new Date() } });
    try {
      const next = await NotesCollection.findOneAsync(noteId, { fields: { title: 1, content: 1, projectId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'note', id: noteId, text: `${next?.title || ''} ${next?.content || ''}`.trim(), projectId: next?.projectId || null });
    } catch (e) { console.error('[search][notes.update] upsert failed', e); }
    if (note && note.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'notes.remove'(noteId) {
    check(noteId, String);
    const note = await NotesCollection.findOneAsync(noteId);
    const res = await NotesCollection.removeAsync(noteId);
    try { const { deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteDoc('note', noteId); } catch (e) { console.error('[search][notes.remove] delete failed', e); }
    if (note && note.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  }
});


