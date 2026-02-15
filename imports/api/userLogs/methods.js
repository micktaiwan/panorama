import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UserLogsCollection } from './collections';
import { toOneLine } from '/imports/api/_shared/strings';
import { ensureLocalOnly } from '/imports/api/_shared/auth';

const sanitizeLog = (input) => {
  const out = { ...input };
  if (typeof out.content === 'string') out.content = toOneLine(out.content);
  return out;
};

Meteor.methods({
  async 'userLogs.insert'(doc) {
    check(doc, Object);
    ensureLocalOnly();
    const now = new Date();
    const sanitized = sanitizeLog(doc);
    const content = String(sanitized.content || '').trim();
    if (!content) {
      throw new Meteor.Error('invalid-content', 'Entry content is required');
    }
    const _id = await UserLogsCollection.insertAsync({
      content,
      createdAt: now
    });
    // Index to vector store (non-blocking best-effort)
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'userlog', id: _id, text: content });
    } catch (e) {
      console.error('[search][userLogs.insert] upsert failed', e);
    }
    return _id;
  },
  async 'userLogs.update'(logId, modifier) {
    check(logId, String);
    check(modifier, Object);
    ensureLocalOnly();
    const set = { ...sanitizeLog(modifier), updatedAt: new Date() };
    const res = await UserLogsCollection.updateAsync(logId, { $set: set });
    // Re-index updated content
    try {
      const next = await UserLogsCollection.findOneAsync({ _id: logId }, { fields: { content: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'userlog', id: logId, text: next?.content || '' });
    } catch (e) {
      console.error('[search][userLogs.update] upsert failed', e);
    }
    return res;
  },
  async 'userLogs.remove'(logId) {
    check(logId, String);
    ensureLocalOnly();
    const res = await UserLogsCollection.removeAsync(logId);
    try {
      const { deleteDoc } = await import('/imports/api/search/vectorStore.js');
      await deleteDoc('userlog', logId);
    } catch (e) {
      console.error('[search][userLogs.remove] delete failed', e);
    }
    return res;
  },
  async 'userLogs.clear'() {
    ensureLocalOnly();
    const ids = await UserLogsCollection.find({}, { fields: { _id: 1 } }).fetchAsync();
    const res = await UserLogsCollection.removeAsync({});
    // Best-effort bulk cleanup of vectors
    try {
      const { deleteDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of ids) {
         
        await deleteDoc('userlog', it._id);
      }
    } catch (e) {
      console.error('[search][userLogs.clear] delete failed', e);
    }
    return res;
  }
});


