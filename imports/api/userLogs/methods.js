import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UserLogsCollection } from './collections';
import { toOneLine } from '/imports/api/_shared/strings';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const sanitizeLog = (input) => {
  const out = { ...input };
  if (typeof out.content === 'string') out.content = toOneLine(out.content);
  return out;
};

Meteor.methods({
  async 'userLogs.insert'(doc) {
    check(doc, Object);
    ensureLoggedIn(this.userId);
    const now = new Date();
    const sanitized = sanitizeLog(doc);
    const content = String(sanitized.content || '').trim();
    if (!content) {
      throw new Meteor.Error('invalid-content', 'Entry content is required');
    }
    const _id = await UserLogsCollection.insertAsync({
      content,
      userId: this.userId,
      createdAt: now
    });
    // Index to vector store (non-blocking best-effort)
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'userlog', id: _id, text: content, userId: this.userId });
    } catch (e) {
      console.error('[search][userLogs.insert] upsert failed', e);
    }
    return _id;
  },
  async 'userLogs.update'(logId, modifier) {
    check(logId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    await ensureOwner(UserLogsCollection, logId, this.userId);
    const set = { ...sanitizeLog(modifier), updatedAt: new Date() };
    const res = await UserLogsCollection.updateAsync(logId, { $set: set });
    // Re-index updated content
    try {
      const next = await UserLogsCollection.findOneAsync({ _id: logId }, { fields: { content: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'userlog', id: logId, text: next?.content || '', userId: this.userId });
    } catch (e) {
      console.error('[search][userLogs.update] upsert failed', e);
    }
    return res;
  },
  async 'userLogs.remove'(logId) {
    check(logId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(UserLogsCollection, logId, this.userId);
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
    ensureLoggedIn(this.userId);
    const ids = await UserLogsCollection.find({ userId: this.userId }, { fields: { _id: 1 } }).fetchAsync();
    const res = await UserLogsCollection.removeAsync({ userId: this.userId });
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


