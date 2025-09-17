import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { CalendarEventsCollection } from './collections';

const isNonEmptyString = Match.Where((x) => typeof x === 'string' && x.trim().length > 0);

Meteor.methods({
  async 'calendar.setIcsUrl'(icsUrl) {
    check(icsUrl, isNonEmptyString);
    const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
    const now = new Date();
    // Normalize common Google Calendar embed URL to ICS URL automatically
    let normalized = String(icsUrl).trim();
    // Support webcal:// by converting to https://
    if (normalized.startsWith('webcal://')) {
      normalized = 'https://' + normalized.slice('webcal://'.length);
    }
    let url = new URL(normalized);
    if (url.hostname.includes('calendar.google.com') && url.pathname.includes('/calendar/embed')) {
      const src = url.searchParams.get('src');
      if (src) {
        const encSrc = encodeURIComponent(src);
        normalized = `https://calendar.google.com/calendar/ical/${encSrc}/public/basic.ics`;
      }
    }
    const pref = await AppPreferencesCollection.findOneAsync({}, { fields: { _id: 1 } });
    if (!pref) {
      const _id = await AppPreferencesCollection.insertAsync({ createdAt: now, updatedAt: now, calendarIcsUrl: normalized });
      return _id;
    }
    await AppPreferencesCollection.updateAsync(pref._id, { $set: { calendarIcsUrl: normalized, updatedAt: now } });
    return pref._id;
  },
  async 'calendar.syncFromIcs'() {
    const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
    const pref = await AppPreferencesCollection.findOneAsync({}, { fields: { calendarIcsUrl: 1 } });
    const url = pref?.calendarIcsUrl || '';
    if (!url) throw new Meteor.Error('no-ics-url', 'No ICS URL set in preferences');

    let ical;
    try {
      const mod = await import('node-ical');
      ical = mod.default || mod;
    } catch (e) {
      console.error('[calendar.syncFromIcs] ICS parser import failed', e);
      throw new Meteor.Error('dep-missing', 'ICS parser not available');
    }

    let data;
    try {
      data = await ical.async.fromURL(url);
    } catch (e) {
      console.error('[calendar.syncFromIcs] ICS fetch failed', { url }, e);
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('404')) {
        throw new Meteor.Error('ics-not-found', 'ICS URL returned 404. Make the calendar public or use the secret iCal address.');
      }
      throw new Meteor.Error('ics-fetch-failed', e?.message || 'Failed to fetch ICS');
    }

    const now = new Date();
    const upserts = [];
    const entries = Object.values(data || {});
    for (const entry of entries) {
      if (!entry || entry.type !== 'VEVENT') continue;
      const uid = String(entry.uid || `${entry.summary || 'event'}-${entry.start?.toISOString?.() || ''}`).trim();
      const start = entry.start ? new Date(entry.start) : undefined;
      const end = entry.end ? new Date(entry.end) : undefined;
      const isMidnightLocal = (d) => d && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
      const isAllDayHeuristic = (() => {
        const typeHint = String(entry.datetype || '').toLowerCase();
        if (typeHint === 'date') return true;
        if (!start || !end) return false;
        const dur = end.getTime() - start.getTime();
        if (dur <= 0) return false;
        const DAY = 24 * 60 * 60 * 1000;
        if (isMidnightLocal(start) && isMidnightLocal(end) && (dur % DAY === 0)) return true;
        return false;
      })();
      const doc = {
        uid,
        title: String(entry.summary || '').trim(),
        description: String(entry.description || '').trim() || undefined,
        location: String(entry.location || '').trim() || undefined,
        start,
        end,
        allDay: isAllDayHeuristic,
        updatedAt: now,
        source: 'ics',
      };
      const existing = await CalendarEventsCollection.findOneAsync({ uid });
      if (existing) {
        await CalendarEventsCollection.updateAsync(existing._id, { $set: doc });
        upserts.push(existing._id);
      } else {
        const _id = await CalendarEventsCollection.insertAsync({ ...doc, createdAt: now });
        upserts.push(_id);
      }
    }
    // optional cleanup: keep only recent/future events
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    await CalendarEventsCollection.removeAsync({ end: { $exists: true, $lt: cutoff } });
    return { ok: true, upserts: upserts.length };
  }
});
