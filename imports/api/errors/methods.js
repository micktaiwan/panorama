import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ErrorsCollection } from './collections';

Meteor.methods({
  async 'errors.insert'(doc) {
    check(doc, Object);
    check(doc.kind, String);
    check(doc.message, String);
    check(doc.context, Match.Maybe(Object));
    const now = new Date();
    const clean = {
      kind: String(doc.kind),
      message: String(doc.message),
      context: doc.context || {},
      createdAt: now,
    };
    return ErrorsCollection.insertAsync(clean);
  },
  async 'errors.removeOld'(olderThanDays = 30) {
    check(olderThanDays, Number);
    const cutoff = new Date(Date.now() - Math.max(1, olderThanDays) * 24 * 60 * 60 * 1000);
    return ErrorsCollection.removeAsync({ createdAt: { $lt: cutoff } });
  }
});


