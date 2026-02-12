import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NoteLinesCollection } from './collections';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'noteLines.insert'(doc) {
    check(doc, Object);
    check(doc.sessionId, String);
    check(doc.content, String);
    const userId = requireUserId();
    const _id = await NoteLinesCollection.insertAsync({ ...doc, userId, createdAt: new Date() });
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'line', id: _id, text: doc.content || '', sessionId: doc.sessionId || null });
    } catch (e) {
      console.error('[search][noteLines.insert] upsert failed', e);
      throw new Meteor.Error('vectorization-failed', 'Search indexing failed, but your note was saved.', { insertedId: _id });
    }
    return { _id };
  },
  async 'noteLines.update'(lineId, modifier) {
    check(lineId, String);
    check(modifier, Object);
    await requireOwnership(NoteLinesCollection, lineId);
    const res = await NoteLinesCollection.updateAsync(lineId, { $set: { ...modifier } });
    try {
      const next = await NoteLinesCollection.findOneAsync(lineId, { fields: { content: 1, sessionId: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'line', id: lineId, text: next?.content || '', sessionId: next?.sessionId || null });
    } catch (e) { console.error('[search][noteLines.update] upsert failed', e); throw new Meteor.Error('vectorization-failed', 'Search indexing failed, but your change was saved.', { lineId }); }
    return { modifiedCount: res };
  },
  async 'noteLines.remove'(lineId) {
    check(lineId, String);
    await requireOwnership(NoteLinesCollection, lineId);
    const res = await NoteLinesCollection.removeAsync(lineId);
    try { const { deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteDoc('line', lineId); }
    catch (e) { console.error('[search][noteLines.remove] delete failed', e); throw new Meteor.Error('search-delete-failed', 'Line deleted, but search index cleanup failed.', { lineId }); }
    return { removedCount: res };
  }
});


