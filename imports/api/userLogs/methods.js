import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UserLogsCollection } from './collections';
import { toOneLine } from '/imports/api/_shared/strings';

const sanitizeLog = (input) => {
  const out = { ...input };
  if (typeof out.content === 'string') out.content = toOneLine(out.content);
  return out;
};

Meteor.methods({
  async 'userLogs.insert'(doc) {
    check(doc, Object);
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
    return _id;
  },
  async 'userLogs.update'(logId, modifier) {
    check(logId, String);
    check(modifier, Object);
    const set = { ...sanitizeLog(modifier), updatedAt: new Date() };
    return await UserLogsCollection.updateAsync(logId, { $set: set });
  },
  async 'userLogs.remove'(logId) {
    check(logId, String);
    return await UserLogsCollection.removeAsync(logId);
  },
  async 'userLogs.clear'() {
    return await UserLogsCollection.removeAsync({});
  }
});


