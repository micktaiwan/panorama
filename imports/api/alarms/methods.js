import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AlarmsCollection } from './collections';
import { computeNextOccurrence } from '/imports/api/_shared/date.js';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

const RecurrenceType = Match.OneOf('none', 'daily', 'weekly', 'monthly');

Meteor.methods({
  async 'alarms.insert'(doc) {
    check(doc, Object);
    ensureLoggedIn(this.userId);
    const now = new Date();
    const userId = this.userId;
    const alarm = {
      title: String((doc.title || 'Alarm')).trim(),
      enabled: doc.enabled !== false,
      nextTriggerAt: new Date(doc.nextTriggerAt),
      recurrence: {
        type: doc.recurrence?.type ? doc.recurrence.type : 'none',
        daysOfWeek: Array.isArray(doc.recurrence?.daysOfWeek) ? doc.recurrence.daysOfWeek : undefined
      },
      snoozedUntilAt: doc.snoozedUntilAt ? new Date(doc.snoozedUntilAt) : undefined,
      done: false,
      userId,
      createdAt: now,
      updatedAt: now
    };
    check(alarm.recurrence.type, RecurrenceType);
    const _id = await AlarmsCollection.insertAsync(alarm);
    // Alarms are not indexed in Qdrant - they are temporary notifications
    return _id;
  },
  async 'alarms.update'(alarmId, modifier) {
    check(alarmId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    await ensureOwner(AlarmsCollection, alarmId, this.userId);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.title === 'string') set.title = set.title.trim();
    if (set.nextTriggerAt) set.nextTriggerAt = new Date(set.nextTriggerAt);
    if (set.snoozedUntilAt) set.snoozedUntilAt = new Date(set.snoozedUntilAt);
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: set });
    // Alarms are not indexed in Qdrant - they are temporary notifications
    return res;
  },
  async 'alarms.remove'(alarmId) {
    check(alarmId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(AlarmsCollection, alarmId, this.userId);
    const res = await AlarmsCollection.removeAsync(alarmId);
    // Alarms are not indexed in Qdrant - no need to delete from vector store
    return res;
  },
  async 'alarms.toggleEnabled'(alarmId, enabled) {
    check(alarmId, String);
    check(enabled, Boolean);
    ensureLoggedIn(this.userId);
    await ensureOwner(AlarmsCollection, alarmId, this.userId);
    return AlarmsCollection.updateAsync(alarmId, { $set: { enabled, updatedAt: new Date() } });
  },
  async 'alarms.snooze'(alarmId, minutes) {
    check(alarmId, String);
    check(minutes, Number);
    ensureLoggedIn(this.userId);
    const now = new Date();
    const doc = await ensureOwner(AlarmsCollection, alarmId, this.userId);
    const candidates = [];
    if (doc?.snoozedUntilAt) candidates.push(new Date(doc.snoozedUntilAt).getTime());
    if (doc?.nextTriggerAt) candidates.push(new Date(doc.nextTriggerAt).getTime());
    candidates.push(now.getTime());
    const baseMs = Math.max(...candidates);
    const until = new Date(baseMs + minutes * 60 * 1000);
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: { snoozedUntilAt: until, enabled: true, done: false, acknowledgedAt: now, updatedAt: new Date() } });
    return res;
  },
  async 'alarms.dismiss'(alarmId) {
    check(alarmId, String);
    ensureLoggedIn(this.userId);
    const doc = await ensureOwner(AlarmsCollection, alarmId, this.userId);
    const now = new Date();
    const recur = (doc.recurrence?.type) || 'none';
    if (recur === 'none') {
      const res = await AlarmsCollection.updateAsync(alarmId, { $set: { enabled: false, done: true, acknowledgedAt: now, updatedAt: new Date(), snoozedUntilAt: null } });
      return res;
    }
    // Compute next occurrence ignoring snooze, based on original nextTriggerAt
    const original = doc.nextTriggerAt ? new Date(doc.nextTriggerAt) : now;
    const next = computeNextOccurrence(original, recur);
    if (!next) {
      const res = await AlarmsCollection.updateAsync(alarmId, { $set: { enabled: false, done: true, acknowledgedAt: now, updatedAt: new Date(), snoozedUntilAt: null } });
      return res;
    }
    const res = await AlarmsCollection.updateAsync(alarmId, {
      $set: {
        nextTriggerAt: next,
        snoozedUntilAt: null,
        enabled: true,
        done: false,
        acknowledgedAt: now,
        updatedAt: new Date()
      }
    });
    return res;
  },
  async 'alarms.markFiredIfDue'(alarmId) {
    check(alarmId, String);
    ensureLoggedIn(this.userId);
    const now = new Date();
    // Mongo doesn't support two $or at same level mixed with others in our shape; emulate acknowledgedAt null/absent check
    const doc = await AlarmsCollection.findOneAsync({ _id: alarmId, userId: this.userId });
    if (!doc) return 0;
    const effective = doc.snoozedUntilAt ? new Date(doc.snoozedUntilAt) : new Date(doc.nextTriggerAt);
    if (!doc.enabled) return 0;
    if (effective.getTime() > now.getTime()) return 0;
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: { snoozedUntilAt: null, lastFiredAt: now, enabled: false, done: true, acknowledgedAt: null, updatedAt: now } });
    return res;
  }
});


