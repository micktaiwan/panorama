import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { CalendarEventsCollection } from './collections';
import { getGoogleCalendarClient, getAuthUrl, exchangeCodeForTokens } from './googleCalendarClient';

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
  },

  async 'calendar.google.getAuthUrl'() {
    try {
      const url = getAuthUrl();
      return { url };
    } catch (e) {
      console.error('[calendar.google.getAuthUrl] Failed', e);
      throw new Meteor.Error('auth-url-failed', e?.message || 'Failed to generate auth URL');
    }
  },

  async 'calendar.google.saveTokens'(code) {
    check(code, isNonEmptyString);
    try {
      const tokens = await exchangeCodeForTokens(code);
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
      const now = new Date();
      const pref = await AppPreferencesCollection.findOneAsync({}, { fields: { _id: 1 } });

      const googleCalendar = {
        refreshToken: tokens.refresh_token,
        lastSyncAt: null
      };

      if (!pref) {
        await AppPreferencesCollection.insertAsync({
          createdAt: now,
          updatedAt: now,
          googleCalendar
        });
      } else {
        await AppPreferencesCollection.updateAsync(pref._id, {
          $set: {
            googleCalendar,
            updatedAt: now
          }
        });
      }

      return { ok: true };
    } catch (e) {
      console.error('[calendar.google.saveTokens] Failed', e);
      throw new Meteor.Error('token-save-failed', e?.message || 'Failed to save tokens');
    }
  },

  async 'calendar.google.sync'(calendarIds) {
    check(calendarIds, Match.Maybe([String]));

    try {
      const { calendar } = getGoogleCalendarClient();
      const now = new Date();
      // Start from today at midnight (local time)
      const todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      const timeMin = todayMidnight;
      const timeMax = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days ahead
      console.log(`[calendar.google.sync] Fetching events from ${timeMin.toISOString()} to ${timeMax.toISOString()}`);

      // If no calendar IDs specified, sync only primary calendar
      // (prevents syncing colleagues' calendars which create false busy slots)
      let calendarsToSync = calendarIds;
      if (!calendarsToSync || calendarsToSync.length === 0) {
        calendarsToSync = ['primary'];
      }

      // First, remove events from calendars we're not syncing
      const calendarIdsSet = new Set(calendarsToSync);
      const removedOthers = await CalendarEventsCollection.removeAsync({
        source: 'google',
        calendarId: { $exists: true, $nin: calendarsToSync }
      });
      if (removedOthers > 0) {
        console.log(`[calendar.google.sync] Removed ${removedOthers} events from other calendars`);
      }

      let totalUpserts = 0;

      for (const calendarId of calendarsToSync) {
        let pageToken = null;
        do {
          const response = await calendar.events.list({
            calendarId,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            pageToken
          });

          const events = response.data.items || [];

          for (const event of events) {
            const uid = event.id || event.iCalUID;
            if (!uid) continue;

            const start = event.start?.dateTime ? new Date(event.start.dateTime) :
                         event.start?.date ? new Date(event.start.date) : null;
            const end = event.end?.dateTime ? new Date(event.end.dateTime) :
                       event.end?.date ? new Date(event.end.date) : null;

            if (!start || !end) continue;

            const doc = {
              uid,
              title: event.summary?.trim() || 'Busy',
              description: event.description?.trim() || undefined,
              location: event.location?.trim() || undefined,
              start,
              end,
              allDay: !!(event.start?.date && !event.start?.dateTime),
              updatedAt: now,
              source: 'google',
              calendarId,
              htmlLink: event.htmlLink,
              status: event.status,
              attendees: event.attendees?.map(att => ({
                email: att.email,
                displayName: att.displayName,
                responseStatus: att.responseStatus,
                organizer: att.organizer,
                self: att.self
              })) || [],
              organizer: event.organizer ? {
                email: event.organizer.email,
                displayName: event.organizer.displayName,
                self: event.organizer.self
              } : undefined,
              conferenceData: event.conferenceData ? {
                entryPoints: event.conferenceData.entryPoints?.map(ep => ({
                  entryPointType: ep.entryPointType,
                  uri: ep.uri,
                  label: ep.label
                }))
              } : undefined,
              transparency: event.transparency,
              visibility: event.visibility,
              colorId: event.colorId,
              created: event.created ? new Date(event.created) : undefined,
              updated: event.updated ? new Date(event.updated) : undefined
            };

            const existing = await CalendarEventsCollection.findOneAsync({ uid });
            if (existing) {
              await CalendarEventsCollection.updateAsync(existing._id, { $set: doc });
            } else {
              await CalendarEventsCollection.insertAsync({ ...doc, createdAt: now });
            }
            totalUpserts++;

            // Debug: log past events that are being kept
            if (doc.start < todayMidnight && doc.end >= todayMidnight) {
              console.log(`[calendar.google.sync] Keeping past multi-day event: "${doc.title}" (start: ${doc.start.toISOString()}, end: ${doc.end.toISOString()})`);
            }
          }

          pageToken = response.data.nextPageToken;
        } while (pageToken);
      }

      // Cleanup: remove past events AND future events beyond our sync window
      const removedPast = await CalendarEventsCollection.removeAsync({
        source: 'google',
        end: { $exists: true, $lt: todayMidnight }
      });
      const removedFuture = await CalendarEventsCollection.removeAsync({
        source: 'google',
        start: { $exists: true, $gt: timeMax }
      });
      console.log(`[calendar.google.sync] Cleaned up ${removedPast} past events and ${removedFuture} far-future events`);

      // Count total events in database after cleanup
      const totalEventsInDb = await CalendarEventsCollection.find({ source: 'google' }).countAsync();
      console.log(`[calendar.google.sync] Total Google events in database: ${totalEventsInDb}`);

      // Update last sync time
      const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
      const pref = await AppPreferencesCollection.findOneAsync({});
      if (pref) {
        await AppPreferencesCollection.updateAsync(pref._id, {
          $set: {
            'googleCalendar.lastSyncAt': now,
            updatedAt: now
          }
        });
      }

      return { ok: true, upserts: totalUpserts, calendars: calendarsToSync.length };
    } catch (e) {
      console.error('[calendar.google.sync] Failed', e);
      throw new Meteor.Error('google-sync-failed', e?.message || 'Failed to sync from Google Calendar');
    }
  },

  async 'calendar.google.listCalendars'() {
    try {
      const { calendar } = getGoogleCalendarClient();
      const response = await calendar.calendarList.list();
      return {
        calendars: response.data.items?.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          description: cal.description,
          primary: cal.primary,
          selected: cal.selected,
          backgroundColor: cal.backgroundColor,
          foregroundColor: cal.foregroundColor
        })) || []
      };
    } catch (e) {
      console.error('[calendar.google.listCalendars] Failed', e);
      throw new Meteor.Error('list-calendars-failed', e?.message || 'Failed to list calendars');
    }
  },

  async 'calendar.google.createEvent'(eventData) {
    check(eventData, {
      summary: String,
      description: Match.Maybe(String),
      start: String, // ISO 8601 string
      end: String,   // ISO 8601 string
      calendarId: Match.Maybe(String)
    });

    try {
      const { calendar } = getGoogleCalendarClient();
      const calendarId = eventData.calendarId || 'primary';

      const event = {
        summary: eventData.summary,
        description: eventData.description || '',
        start: {
          dateTime: eventData.start,
          timeZone: 'Europe/Paris'
        },
        end: {
          dateTime: eventData.end,
          timeZone: 'Europe/Paris'
        }
      };

      const response = await calendar.events.insert({
        calendarId,
        resource: event
      });

      console.log('[calendar.google.createEvent] Created event:', response.data.id);

      // Sync to update local DB
      await Meteor.callAsync('calendar.google.sync');

      return {
        ok: true,
        eventId: response.data.id,
        htmlLink: response.data.htmlLink
      };
    } catch (e) {
      console.error('[calendar.google.createEvent] Failed', e);
      throw new Meteor.Error('create-event-failed', e?.message || 'Failed to create event');
    }
  },

  async 'calendar.google.deleteEvent'(eventId, calendarIdParam) {
    check(eventId, isNonEmptyString);
    check(calendarIdParam, Match.Maybe(String));

    try {
      const { calendar } = getGoogleCalendarClient();
      const calendarId = calendarIdParam || 'primary';

      await calendar.events.delete({
        calendarId,
        eventId
      });

      console.log('[calendar.google.deleteEvent] Deleted event:', eventId);

      // Remove from local DB
      await CalendarEventsCollection.removeAsync({ uid: eventId });

      // Sync to update local DB
      await Meteor.callAsync('calendar.google.sync');

      return { ok: true };
    } catch (e) {
      console.error('[calendar.google.deleteEvent] Failed', e);
      throw new Meteor.Error('delete-event-failed', e?.message || 'Failed to delete event');
    }
  }
});
