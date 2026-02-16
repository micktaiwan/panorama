import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NoteLinesCollection } from './collections';
import { NoteSessionsCollection } from '/imports/api/noteSessions/collections';
import { ensureLoggedIn, ensureOwner, ensureProjectAccess } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'noteLines.insert'(doc) {
    check(doc, Object);
    ensureLoggedIn(this.userId);
    check(doc.sessionId, String);
    check(doc.content, String);
    // Propagate projectId from the parent session
    const session = await NoteSessionsCollection.findOneAsync(doc.sessionId, { fields: { projectId: 1 } });
    const projectId = session?.projectId || null;
    if (projectId) await ensureProjectAccess(projectId, this.userId);
    const _id = await NoteLinesCollection.insertAsync({ ...doc, projectId, userId: this.userId, createdAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'line', id: _id, text: doc.content || '', sessionId: doc.sessionId || null, userId: this.userId });
    } catch (e) {
      console.error('[search][noteLines.insert] upsert failed', e);
      throw new Meteor.Error('vectorization-failed', 'Search indexing failed, but your note was saved.', { insertedId: _id });
    }
    return { _id };
  },
  async 'noteLines.update'(lineId, modifier) {
    check(lineId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    const line = await NoteLinesCollection.findOneAsync(lineId);
    if (!line) throw new Meteor.Error('not-found', 'Line not found');
    if (line.projectId) {
      await ensureProjectAccess(line.projectId, this.userId);
    } else if (line.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Line not found');
    }
    const res = await NoteLinesCollection.updateAsync(lineId, { $set: { ...modifier } });
    try {
      const next = await NoteLinesCollection.findOneAsync(lineId, { fields: { content: 1, sessionId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'line', id: lineId, text: next?.content || '', sessionId: next?.sessionId || null, userId: this.userId });
    } catch (e) { console.error('[search][noteLines.update] upsert failed', e); throw new Meteor.Error('vectorization-failed', 'Search indexing failed, but your change was saved.', { lineId }); }
    return { modifiedCount: res };
  },
  async 'noteLines.remove'(lineId) {
    check(lineId, String);
    ensureLoggedIn(this.userId);
    const line = await NoteLinesCollection.findOneAsync(lineId);
    if (!line) throw new Meteor.Error('not-found', 'Line not found');
    if (line.projectId) {
      await ensureProjectAccess(line.projectId, this.userId);
    } else if (line.userId !== this.userId) {
      throw new Meteor.Error('not-found', 'Line not found');
    }
    const res = await NoteLinesCollection.removeAsync(lineId);
    try { const { deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteDoc('line', lineId); }
    catch (e) { console.error('[search][noteLines.remove] delete failed', e); throw new Meteor.Error('search-delete-failed', 'Line deleted, but search index cleanup failed.', { lineId }); }
    return { removedCount: res };
  }
});


