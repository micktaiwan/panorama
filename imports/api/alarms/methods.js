import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AlarmsCollection } from './collections';
import { computeNextOccurrence } from '/imports/api/_shared/date.js';

const RecurrenceType = Match.OneOf('none', 'daily', 'weekly', 'monthly');

Meteor.methods({
  async 'alarms.insert'(doc) {
    check(doc, Object);
    const now = new Date();
    const userId = this.userId || null;
    const alarm = {
      title: String((doc.title || 'Alarm')).trim(),
      enabled: doc.enabled !== false,
      nextTriggerAt: new Date(doc.nextTriggerAt),
      recurrence: {
        type: doc.recurrence && doc.recurrence.type ? doc.recurrence.type : 'none',
        daysOfWeek: Array.isArray(doc.recurrence && doc.recurrence.daysOfWeek) ? doc.recurrence.daysOfWeek : undefined
      },
      snoozedUntilAt: doc.snoozedUntilAt ? new Date(doc.snoozedUntilAt) : undefined,
      done: false,
      userId,
      createdAt: now,
      updatedAt: now
    };
    check(alarm.recurrence.type, RecurrenceType);
    const _id = await AlarmsCollection.insertAsync(alarm);
    try {
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'alarm', id: _id, text: alarm.title || '' });
    } catch (e) { console.error('[search][alarms.insert] upsert failed', e); }
    return _id;
  },
  async 'alarms.update'(alarmId, modifier) {
    check(alarmId, String);
    check(modifier, Object);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.title === 'string') set.title = set.title.trim();
    if (set.nextTriggerAt) set.nextTriggerAt = new Date(set.nextTriggerAt);
    if (set.snoozedUntilAt) set.snoozedUntilAt = new Date(set.snoozedUntilAt);
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: set });
    try {
      const next = await AlarmsCollection.findOneAsync(alarmId, { fields: { title: 1 } });
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      await upsertDoc({ kind: 'alarm', id: alarmId, text: next?.title || '' });
    } catch (e) { console.error('[search][alarms.update] upsert failed', e); }
    return res;
  },
  async 'alarms.remove'(alarmId) {
    check(alarmId, String);
    const res = await AlarmsCollection.removeAsync(alarmId);
    try { const { deleteDoc } = await import('/imports/api/search/vectorStore.js'); await deleteDoc('alarm', alarmId); } catch (e) { console.error('[search][alarms.remove] delete failed', e); }
    return res;
  },
  async 'alarms.toggleEnabled'(alarmId, enabled) {
    check(alarmId, String);
    check(enabled, Boolean);
    return AlarmsCollection.updateAsync(alarmId, { $set: { enabled, updatedAt: new Date() } });
  },
  async 'alarms.snooze'(alarmId, minutes) {
    check(alarmId, String);
    check(minutes, Number);
    const now = new Date();
    const doc = await AlarmsCollection.findOneAsync(alarmId);
    const candidates = [];
    if (doc && doc.snoozedUntilAt) candidates.push(new Date(doc.snoozedUntilAt).getTime());
    if (doc && doc.nextTriggerAt) candidates.push(new Date(doc.nextTriggerAt).getTime());
    candidates.push(now.getTime());
    const baseMs = Math.max(...candidates);
    const until = new Date(baseMs + minutes * 60 * 1000);
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: { snoozedUntilAt: until, enabled: true, done: false, acknowledgedAt: now, updatedAt: new Date() } });
    console.log('[alarms.snooze]', { alarmId, minutes, until, updated: res });
    return res;
  },
  async 'alarms.dismiss'(alarmId) {
    check(alarmId, String);
    const doc = await AlarmsCollection.findOneAsync(alarmId);
    const now = new Date();
    if (!doc) return 0;
    const recur = (doc.recurrence && doc.recurrence.type) || 'none';
    if (recur === 'none') {
      const res = await AlarmsCollection.updateAsync(alarmId, { $set: { enabled: false, done: true, acknowledgedAt: now, updatedAt: new Date(), snoozedUntilAt: null } });
      console.log('[alarms.dismiss]', { alarmId, recurring: false, updated: res });
      return res;
    }
    // Compute next occurrence ignoring snooze, based on original nextTriggerAt
    const original = doc.nextTriggerAt ? new Date(doc.nextTriggerAt) : now;
    const next = computeNextOccurrence(original, recur);
    if (!next) {
      const res = await AlarmsCollection.updateAsync(alarmId, { $set: { enabled: false, done: true, acknowledgedAt: now, updatedAt: new Date(), snoozedUntilAt: null } });
      console.log('[alarms.dismiss]', { alarmId, recurring: 'invalid', updated: res });
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
    console.log('[alarms.dismiss]', { alarmId, recurring: recur, next: next.toISOString(), updated: res });
    return res;
  },
  async 'alarms.markFiredIfDue'(alarmId) {
    check(alarmId, String);
    const now = new Date();
    const selector = {
      _id: alarmId,
      enabled: true,
      $or: [
        { snoozedUntilAt: { $lte: now } },
        { snoozedUntilAt: { $exists: false }, nextTriggerAt: { $lte: now } }
      ],
      $or_acked: true
    };
    // Mongo doesn't support two $or at same level mixed with others in our shape; emulate acknowledgedAt null/absent check
    const doc = await AlarmsCollection.findOneAsync(alarmId);
    if (!doc) return 0;
    const effective = doc.snoozedUntilAt ? new Date(doc.snoozedUntilAt) : new Date(doc.nextTriggerAt);
    if (!doc.enabled) return 0;
    if (!(effective.getTime() <= now.getTime())) return 0;
    const res = await AlarmsCollection.updateAsync(alarmId, { $set: { snoozedUntilAt: null, lastFiredAt: now, enabled: false, done: true, acknowledgedAt: null, updatedAt: now } });
    console.log('[alarms.markFiredIfDue]', { alarmId, updated: res });
    return res;
  }
});


