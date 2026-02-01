import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';

// Normalize short text fields
const sanitizeNoteDoc = (input) => {
  const out = { ...input };
  if (typeof out.title === 'string') out.title = out.title.trim();
  // content is kept as-is (no trim) - no assignment needed
  return out;
};

Meteor.methods({
  async 'notes.insert'(doc) {
    check(doc, Object);
    const sanitized = sanitizeNoteDoc(doc);
    const _id = await NotesCollection.insertAsync({ ...sanitized, createdAt: new Date() });
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await upsertDocChunks({ kind: 'note', id: _id, text: `${sanitized.title || ''} ${sanitized.content || ''}`.trim(), projectId: sanitized.projectId || null, minChars: 800, maxChars: 1200, overlap: 150 });
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

    // Check if content has actually changed
    let hasChanged = false;
    for (const key of Object.keys(sanitized)) {
      if (sanitized[key] !== note?.[key]) {
        hasChanged = true;
        break;
      }
    }

    // Only update updatedAt if content has changed
    const updateDoc = hasChanged ? { ...sanitized, updatedAt: new Date() } : sanitized;
    const res = await NotesCollection.updateAsync(noteId, { $set: updateDoc });

    try {
      const next = await NotesCollection.findOneAsync(noteId, { fields: { title: 1, content: 1, projectId: 1 } });
      const { deleteByDocId, upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await deleteByDocId('note', noteId);
      await upsertDocChunks({ kind: 'note', id: noteId, text: `${next?.title || ''} ${next?.content || ''}`.trim(), projectId: next?.projectId || null, minChars: 800, maxChars: 1200, overlap: 150 });
    } catch (e) { console.error('[search][notes.update] upsert failed', e); }

    // Only update project timestamp if note content changed
    if (hasChanged && note?.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'notes.remove'(noteId) {
    check(noteId, String);
    const note = await NotesCollection.findOneAsync(noteId);
    const res = await NotesCollection.removeAsync(noteId);
    try { const { deleteByDocId } = await import('/imports/api/search/vectorStore.js'); await deleteByDocId('note', noteId); } catch (e) { console.error('[search][notes.remove] delete failed', e); }
    if (note?.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'notes.duplicate'(noteId) {
    check(noteId, String);
    const originalNote = await NotesCollection.findOneAsync(noteId);
    if (!originalNote) {
      throw new Meteor.Error('not-found', 'Note not found');
    }
    
    const duplicatedDoc = {
      title: originalNote.title ? `${originalNote.title} (copy)` : 'Untitled (copy)',
      content: originalNote.content || '',
      projectId: originalNote.projectId || null,
      ...(originalNote.claudeProjectId ? { claudeProjectId: originalNote.claudeProjectId } : {}),
    };
    
    const sanitized = sanitizeNoteDoc(duplicatedDoc);
    const _id = await NotesCollection.insertAsync({ ...sanitized, createdAt: new Date() });
    
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await upsertDocChunks({ kind: 'note', id: _id, text: `${sanitized.title || ''} ${sanitized.content || ''}`.trim(), projectId: sanitized.projectId || null, minChars: 800, maxChars: 1200, overlap: 150 });
    } catch (e) { console.error('[search][notes.duplicate] upsert failed', e); }
    
    if (duplicatedDoc.projectId) {
      await ProjectsCollection.updateAsync(duplicatedDoc.projectId, { $set: { updatedAt: new Date() } });
    }
    
    return _id;
  }
});


