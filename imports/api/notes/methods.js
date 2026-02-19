import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotesCollection } from './collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ensureLoggedIn, ensureProjectAccess } from '/imports/api/_shared/auth';

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
    ensureLoggedIn(this.userId);
    if (doc.projectId) await ensureProjectAccess(doc.projectId, this.userId);
    const sanitized = sanitizeNoteDoc(doc);
    const _id = await NotesCollection.insertAsync({ ...sanitized, userId: this.userId, createdAt: new Date() });
    let vectorError;
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await upsertDocChunks({ kind: 'note', id: _id, text: `${sanitized.title || ''} ${sanitized.content || ''}`.trim(), projectId: sanitized.projectId || null, userId: this.userId, minChars: 800, maxChars: 1200, overlap: 150 });
    } catch (e) {
      console.error('[search][notes.insert] upsert failed', e);
      vectorError = e instanceof Meteor.Error ? e : new Meteor.Error('vectorization-failed', 'Search indexing failed, but your note was saved.', { insertedId: _id });
    }
    if (doc.projectId) {
      await ProjectsCollection.updateAsync(doc.projectId, { $set: { updatedAt: new Date() } });
    }
    if (vectorError) throw vectorError;
    return _id;
  },
  async 'notes.acquireLock'(noteId) {
    check(noteId, String);
    ensureLoggedIn(this.userId);
    const note = await NotesCollection.findOneAsync(noteId);
    if (!note) throw new Meteor.Error('not-found', 'Note not found');
    if (note.projectId) {
      await ensureProjectAccess(note.projectId, this.userId);
    } else if (note.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Note not found');
    }

    // Idempotent: already locked by this user → refresh lockedAt
    if (note.lockedBy === this.userId) {
      await NotesCollection.updateAsync(noteId, { $set: { lockedAt: new Date() } });
      return true;
    }

    // Locked by someone else
    if (note.lockedBy) {
      throw new Meteor.Error('note-locked', 'Note is being edited by another user');
    }

    // Atomic acquire: only succeeds if no one grabbed it in the meantime
    const result = await NotesCollection.rawCollection().findOneAndUpdate(
      { _id: noteId, lockedBy: { $exists: false } },
      { $set: { lockedBy: this.userId, lockedAt: new Date() } },
    );
    if (!result) {
      throw new Meteor.Error('note-locked', 'Note is being edited by another user');
    }
    return true;
  },
  async 'notes.releaseLock'(noteId) {
    check(noteId, String);
    ensureLoggedIn(this.userId);
    // Only release if locked by this user — silent return otherwise
    await NotesCollection.updateAsync(
      { _id: noteId, lockedBy: this.userId },
      { $unset: { lockedBy: '', lockedAt: '' } }
    );
    return true;
  },
  async 'notes.update'(noteId, modifier) {
    check(noteId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    const note = await NotesCollection.findOneAsync(noteId);
    if (!note) throw new Meteor.Error('not-found', 'Note not found');
    if (note.projectId) {
      await ensureProjectAccess(note.projectId, this.userId);
    } else if (note.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Note not found');
    }

    // Lock guard: reject update if locked by another user
    if (note.lockedBy && note.lockedBy !== this.userId) {
      throw new Meteor.Error('note-locked', 'Note is being edited by another user');
    }

    const sanitized = sanitizeNoteDoc(modifier);

    // Check if content has actually changed
    let hasChanged = false;
    for (const key of Object.keys(sanitized)) {
      if (sanitized[key] !== note?.[key]) {
        hasChanged = true;
        break;
      }
    }

    // Check if searchable content changed (for Qdrant re-indexing)
    const contentChanged = ('title' in sanitized && sanitized.title !== note?.title)
      || ('content' in sanitized && sanitized.content !== note?.content);

    // If updatedAt is explicitly provided (for reordering), use it as-is
    // Otherwise, only update updatedAt if content has changed
    const updateDoc = modifier.updatedAt
      ? sanitized
      : (hasChanged ? { ...sanitized, updatedAt: new Date() } : sanitized);
    const res = await NotesCollection.updateAsync(noteId, { $set: updateDoc });

    let vectorError;
    if (contentChanged) {
      try {
        const next = await NotesCollection.findOneAsync(noteId, { fields: { title: 1, content: 1, projectId: 1 } });
        const { deleteByDocId, upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
        await deleteByDocId('note', noteId);
        await upsertDocChunks({ kind: 'note', id: noteId, text: `${next?.title || ''} ${next?.content || ''}`.trim(), projectId: next?.projectId || null, userId: this.userId, minChars: 800, maxChars: 1200, overlap: 150 });
      } catch (e) {
        console.error('[search][notes.update] upsert failed', e);
        vectorError = e instanceof Meteor.Error ? e : new Meteor.Error('vectorization-failed', 'Search indexing failed, but your change was saved.');
      }
    }

    // Release lock after successful save (save = release)
    if (note.lockedBy === this.userId && 'content' in modifier) {
      await NotesCollection.updateAsync(noteId, { $unset: { lockedBy: '', lockedAt: '' } });
    }

    // Only update project timestamp if note content changed
    if (hasChanged && note?.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    if (vectorError) throw vectorError;
    return res;
  },
  async 'notes.remove'(noteId) {
    check(noteId, String);
    ensureLoggedIn(this.userId);
    const note = await NotesCollection.findOneAsync(noteId);
    if (!note) throw new Meteor.Error('not-found', 'Note not found');
    if (note.projectId) {
      await ensureProjectAccess(note.projectId, this.userId);
    } else if (note.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Note not found');
    }
    const res = await NotesCollection.removeAsync(noteId);
    try { const { deleteByDocId } = await import('/imports/api/search/vectorStore.js'); await deleteByDocId('note', noteId); } catch (e) { console.error('[search][notes.remove] delete failed', e); }
    if (note?.projectId) {
      await ProjectsCollection.updateAsync(note.projectId, { $set: { updatedAt: new Date() } });
    }
    return res;
  },
  async 'notes.duplicate'(noteId) {
    check(noteId, String);
    ensureLoggedIn(this.userId);
    const originalNote = await NotesCollection.findOneAsync(noteId);
    if (!originalNote) throw new Meteor.Error('not-found', 'Note not found');
    if (originalNote.projectId) {
      await ensureProjectAccess(originalNote.projectId, this.userId);
    } else if (originalNote.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Note not found');
    }
    
    const duplicatedDoc = {
      title: originalNote.title ? `${originalNote.title} (copy)` : 'Untitled (copy)',
      content: originalNote.content || '',
      projectId: originalNote.projectId || null,
      ...(originalNote.claudeProjectId ? { claudeProjectId: originalNote.claudeProjectId } : {}),
    };
    
    const sanitized = sanitizeNoteDoc(duplicatedDoc);
    const _id = await NotesCollection.insertAsync({ ...sanitized, userId: this.userId, createdAt: new Date() });

    let vectorError;
    try {
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      await upsertDocChunks({ kind: 'note', id: _id, text: `${sanitized.title || ''} ${sanitized.content || ''}`.trim(), projectId: sanitized.projectId || null, userId: this.userId, minChars: 800, maxChars: 1200, overlap: 150 });
    } catch (e) {
      console.error('[search][notes.duplicate] upsert failed', e);
      vectorError = e instanceof Meteor.Error ? e : new Meteor.Error('vectorization-failed', 'Search indexing failed, but your note was saved.', { insertedId: _id });
    }

    if (duplicatedDoc.projectId) {
      await ProjectsCollection.updateAsync(duplicatedDoc.projectId, { $set: { updatedAt: new Date() } });
    }

    if (vectorError) throw vectorError;
    return _id;
  }
});


