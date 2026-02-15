import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ErrorsCollection } from './collections';
import { ensureLocalOnly } from '/imports/api/_shared/auth';

Meteor.methods({
  async 'errors.insert'(doc) {
    check(doc, Object);
    check(doc.kind, String);
    check(doc.message, String);
    check(doc.context, Match.Maybe(Object));
    ensureLocalOnly();
    const now = new Date();
    const clean = {
      kind: String(doc.kind),
      message: String(doc.message),
      context: doc.context || {},
      createdAt: now,
    };
    return ErrorsCollection.insertAsync(clean);
  },
  async 'errors.markShown'(idOrIds) {
    check(idOrIds, Match.OneOf(String, [String]));
    ensureLocalOnly();
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const now = new Date();
    return ErrorsCollection.updateAsync(
      { _id: { $in: ids }, $or: [{ shownAt: { $exists: false } }, { shownAt: null }] },
      { $set: { shownAt: now } },
      { multi: true }
    );
  },
  async 'errors.removeOld'(olderThanDays = 30) {
    check(olderThanDays, Number);
    ensureLocalOnly();
    const cutoff = new Date(Date.now() - Math.max(1, olderThanDays) * 24 * 60 * 60 * 1000);
    return ErrorsCollection.removeAsync({ createdAt: { $lt: cutoff } });
  }
});


