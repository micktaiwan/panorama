import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { CalendarEventsCollection } from '/imports/api/calendar/collections';
import { TasksCollection } from '/imports/api/tasks/collections';
import { ProjectsCollection } from '/imports/api/projects/collections';
import { ProjectFilters } from '/imports/ui/components/ProjectFilters/ProjectFilters.jsx';
import './CalendarPage.css';
import { notify } from '/imports/ui/utils/notify.js';
import {
  WORK_START_HOUR,
  WORK_END_HOUR,
  startOfDay,
  endOfDay,
  clamp,
  localDayKey,
  mergeIntervals,
  shiftOutOfLunch,
  windowLengthMin,
} from '/imports/ui/utils/scheduleHelpers.js';

export const CalendarPage = () => {
  const sub = useSubscribe('calendar.events.upcoming');
  const events = useFind(() => CalendarEventsCollection.find({}, { sort: { start: 1 } }));
  // Project filters (tri-state) with localStorage persistence
  const [projFilters, setProjFilters] = React.useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('calendar_proj_filters') : null;
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_e) { return {}; }
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const includeIds = React.useMemo(() => Object.entries(projFilters).filter(([, v]) => v === 1).map(([k]) => k), [JSON.stringify(projFilters)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const excludeIds = React.useMemo(() => Object.entries(projFilters).filter(([, v]) => v === -1).map(([k]) => k), [JSON.stringify(projFilters)]);
  // Tasks subscriptions: unfiltered for suggestions, filtered for scheduled tasks
  const subTasksOpen = useSubscribe('tasks.calendar.open.unfiltered');
  const subTasksScheduled = useSubscribe('tasks.calendar.scheduled', includeIds, excludeIds);
  // Projects for filter UI
  const subProjects = useSubscribe('projects');
  const projects = useFind(() => ProjectsCollection.find({}, { fields: { name: 1, isFavorite: 1, favoriteRank: 1 } }));
  // Server publishes: top 20 open unscheduled tasks and scheduled tasks within 7 days (via two subscriptions)
  const tasks = useFind(() => TasksCollection.find({}, { fields: { title: 1, status: 1, deadline: 1, isUrgent: 1, isImportant: 1, projectId: 1, createdAt: 1, scheduledAt: 1, scheduledDurationMin: 1 } }));
  const [syncing, setSyncing] = React.useState(false);
  const [showRaw, setShowRaw] = React.useState(false);
  const [editEstimateTaskId, setEditEstimateTaskId] = React.useState('');
  const [hideMultiDay, setHideMultiDay] = React.useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('calendar_hide_multi_day') : null;
      return raw === 'true';
    } catch (_e) { return false; }
  });
  const [availableCalendars, setAvailableCalendars] = React.useState([]);
  const [loadingCalendars, setLoadingCalendars] = React.useState(false);
  const [showCalendarFilters, setShowCalendarFilters] = React.useState(false);
  const [hiddenCalendars, setHiddenCalendars] = React.useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('calendar_hidden_calendars') : null;
      return raw ? JSON.parse(raw) : [];
    } catch (_e) { return []; }
  });
  // Lightweight change keys to avoid costly JSON.stringify deps
  const eventsKey = React.useMemo(
    () => (events || []).map(e => `${e?._id || ''}:${e?.start || ''}:${e?.end || ''}`).join('|'),
    [events]
  );
  const tasksKey = React.useMemo(
    () => (tasks || []).map(t => `${t?._id || ''}:${t?.status || ''}:${t?.deadline || ''}:${t?.isUrgent ? '1' : '0'}:${t?.isImportant ? '1' : '0'}:${t?.scheduledDurationMin || ''}:${t?.scheduledAt || ''}`).join('|'),
    [tasks]
  );
  const rawJson = React.useMemo(
    () => (showRaw ? JSON.stringify(events || [], null, 2) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showRaw, eventsKey]
  );
  const rawRef = React.useRef(null);
  React.useEffect(() => {
    if (showRaw && rawRef && rawRef.current && typeof rawRef.current.scrollIntoView === 'function') {
      rawRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showRaw]);

  const loadCalendars = React.useCallback(() => {
    setLoadingCalendars(true);
    Meteor.call('calendar.google.listCalendars', (err, res) => {
      setLoadingCalendars(false);
      if (err) {
        notify({ message: err?.reason || err?.message || 'Failed to load calendars', kind: 'error' });
        return;
      }
      setAvailableCalendars(res?.calendars || []);
    });
  }, []);

  const onSync = () => {
    setSyncing(true);
    Meteor.call('calendar.google.sync', null, (err, res) => {
      setSyncing(false);
      if (err) { notify({ message: err?.reason || err?.message || 'Sync failed', kind: 'error' }); return; }
      notify({ message: `Synced ${res?.upserts || 0} events from ${res?.calendars || 0} calendars`, kind: 'success' });
    });
  };

  const toggleCalendarVisibility = (calendarId) => {
    setHiddenCalendars((prev) => {
      const next = prev.includes(calendarId)
        ? prev.filter(id => id !== calendarId)
        : [...prev, calendarId];
      try {
        localStorage.setItem('calendar_hidden_calendars', JSON.stringify(next));
      } catch (err) {
        console.warn('[calendar] localStorage write failed', err);
      }
      return next;
    });
  };

  // Load calendars on mount
  React.useEffect(() => {
    loadCalendars();
  }, [loadCalendars]);

  // Suggestion logic (Phase 1): pick top tasks and propose slots in free windows
  const { suggestions, debug } = React.useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const bufferMin = 0; // minutes before/after events (removed to maximize free slots)
    const minSlotMin = 15; // minimum slot length

    const days = [];
    for (let dt = startOfDay(now); dt <= horizon; dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000)) {
      days.push(new Date(dt));
    }

    // Base busy intervals from calendar events (exclude transparent/all-day events that don't block time)
    const eventIntervals = events
      .filter(e => e?.start && e?.end)
      .filter(e => {
        // Exclude all-day events - they don't block work time
        if (e.allDay) return false;
        // Exclude transparent events (like "Office" working location)
        if (e.transparency === 'transparent') return false;
        return true;
      })
      .map(e => ({ start: new Date(e.start), end: new Date(e.end), title: e.title }));

    // Add scheduled tasks as busy too
    const scheduledIntervals = tasks
      .filter(t => !!t.scheduledAt)
      .map(t => {
        const start = new Date(t.scheduledAt);
        const minutes = Number.isFinite(Number(t.scheduledDurationMin)) ? Math.max(15, Number(t.scheduledDurationMin)) : 60;
        const end = new Date(start.getTime() + minutes * 60000);
        return { start, end, title: t.title, source: 'task' };
      });

    const baseIntervals = [...eventIntervals, ...scheduledIntervals]
      .filter(e => e.end > now && e.start < horizon)
      .map(e => ({
        start: new Date(e.start.getTime() - bufferMin * 60000),
        end: new Date(e.end.getTime() + bufferMin * 60000)
      }))
      .sort((a, b) => a.start - b.start);


    const freeWindows = [];
    days.forEach((day) => {
      const workStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_START_HOUR, 0, 0, 0);
      const workEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), WORK_END_HOUR, 0, 0, 0);
      const dayStart = day;
      const dayEnd = endOfDay(day);
      let boundsStart = clamp(workStart, dayStart, dayEnd);
      const isToday = day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate();
      if (isToday) boundsStart = new Date(Math.max(boundsStart.getTime(), now.getTime()));
      const boundsEnd = clamp(workEnd, dayStart, dayEnd);
      if (!(boundsEnd > boundsStart)) return;
      // Build local busy intervals from base intervals
      const arr = baseIntervals
        .filter(e => e.end > boundsStart && e.start < boundsEnd)
        .map(e => ({ start: clamp(e.start, boundsStart, boundsEnd), end: clamp(e.end, boundsStart, boundsEnd) }));

      // Don't add lunch break as busy by default - only real calendar events count
      // (The shiftOutOfLunch helper will handle lunch conflicts when placing tasks)
      arr.sort((a, b) => a.start - b.start);
      const busy = mergeIntervals(arr).filter(b => b.end > b.start);

      let cursor = boundsStart;
      for (const b of busy) {
        if (b.start > cursor) freeWindows.push({ start: new Date(cursor), end: new Date(b.start) });
        cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
      }
      if (cursor < boundsEnd) freeWindows.push({ start: new Date(cursor), end: new Date(boundsEnd) });
    });

    const sizedWindows = freeWindows
      .map(w => ({ ...w, minutes: Math.floor((w.end.getTime() - w.start.getTime()) / 60000) }))
      .filter(w => w.minutes >= minSlotMin)
      .sort((a, b) => a.start - b.start);

    // 2) Candidate tasks (open only, and not already scheduled)
    const openTasks = tasks.filter(t => !['done','cancelled'].includes(t.status || '') && !t.scheduledAt);
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    const score = (t) => {
      const dueMs = t.deadline ? (new Date(t.deadline).getTime() - now.getTime()) : (14 * DAY);
      const urgentBias = t.isUrgent ? (-2 * DAY) : 0;
      const importantBias = t.isImportant ? (-12 * HOUR) : 0;
      const inProgressBias = (t.status === 'in_progress') ? (-6 * HOUR) : 0;
      return dueMs + urgentBias + importantBias + inProgressBias;
    };
    const top = [...openTasks]
      .sort((a, b) => score(a) - score(b))
      .slice(0, 12);

    const propose = [];
    const avail = sizedWindows.map(w => ({ start: new Date(w.start), end: new Date(w.end) }));
    
    for (const t of top) {
      const hasEst = Number.isFinite(Number(t.scheduledDurationMin)) && Number(t.scheduledDurationMin) > 0;
      const dl = t.deadline ? new Date(t.deadline) : null;
      if (!hasEst) {
        // Require user estimate first: propose earliest window start (without consuming)
        const earliestIdx = avail.findIndex(w => (dl ? w.start <= dl : true) && windowLengthMin(w) >= 15);
        const w0 = earliestIdx >= 0 ? avail[earliestIdx] : avail[0];
        if (w0) {
          let slotStart = new Date(w0.start);
          const adjust = shiftOutOfLunch(slotStart, 15);
          if (adjust.minutes >= 15) {
            slotStart = adjust.start;
          } else {
            // if lunch absorbs the 15m, skip to after lunch window if available
            const afterLunch = avail.find(w => w.start >= new Date(slotStart.getFullYear(), slotStart.getMonth(), slotStart.getDate(), 14, 0, 0, 0));
            if (afterLunch && windowLengthMin(afterLunch) >= 15) slotStart = new Date(afterLunch.start);
          }
          const tempEnd = new Date(slotStart.getTime() + 15 * 60000);
          const why = [];
          if (t.isImportant) why.push('important');
          if (t.isUrgent) why.push('urgent');
          if (t.deadline && slotStart > new Date(t.deadline)) {
            const hrsLate = Math.round((slotStart.getTime() - new Date(t.deadline).getTime()) / 3600000);
            why.push(`after deadline by ~${hrsLate}h`);
          }
          propose.push({ task: t, start: slotStart, end: tempEnd, minutes: 15, why, needsEstimate: true });
        }
        if (propose.length >= 5) break;
        continue;
      }
      // Has estimate: place normally
      const desiredMin = Math.max(15, Number(t.scheduledDurationMin));
      const idx = avail.findIndex(w => (dl ? w.start <= dl : true) && windowLengthMin(w) >= 15);
      if (idx === -1) {
        // fallback after-deadline if no window
        if (avail[0]) {
          let slotStart = new Date(avail[0].start);
          let actualMin = Math.min(desiredMin, windowLengthMin(avail[0]));
          const adj = shiftOutOfLunch(slotStart, actualMin);
          slotStart = adj.start; actualMin = adj.minutes;
          if (actualMin < 15) { if (propose.length >= 5) break; continue; }
          const slotEnd = new Date(slotStart.getTime() + actualMin * 60000);
          const why = [];
          if (t.isImportant) why.push('important');
          if (t.isUrgent) why.push('urgent');
          if (t.deadline && slotStart > new Date(t.deadline)) {
            const hrsLate = Math.round((slotStart.getTime() - new Date(t.deadline).getTime()) / 3600000);
            why.push(`after deadline by ~${hrsLate}h`);
          }
          propose.push({ task: t, start: slotStart, end: slotEnd, minutes: actualMin, why });
        }
        if (propose.length >= 5) break;
        continue;
      }
      const w = avail[idx];
      if (windowLengthMin(w) < 15) { if (propose.length >= 5) break; continue; }
      let slotStart = new Date(w.start);
      let actualMin = Math.min(desiredMin, windowLengthMin(w));
      const adj = shiftOutOfLunch(slotStart, actualMin);
      slotStart = adj.start; actualMin = adj.minutes;
      if (actualMin < 15) { if (propose.length >= 5) break; continue; }
      const slotEnd = new Date(slotStart.getTime() + actualMin * 60000);
      const newStart = new Date(slotEnd.getTime());
      if (newStart < w.end) {
        avail[idx] = { start: newStart, end: w.end };
      } else {
        avail.splice(idx, 1);
      }
      const why = [];
      if (t.isImportant) why.push('important');
      if (t.isUrgent) why.push('urgent');
      if (t.deadline) {
        const hrs = Math.round((new Date(t.deadline).getTime() - slotStart.getTime()) / 3600000);
        why.push(`due in ~${hrs}h`);
      }
      if (actualMin < desiredMin) why.push(`trimmed to ${actualMin}m`);
      propose.push({ task: t, start: slotStart, end: slotEnd, minutes: actualMin, why });
      if (propose.length >= 5) break;
    }

    if (propose.length === 0) {
      const avail2 = sizedWindows.map(w => ({ start: new Date(w.start), end: new Date(w.end) }));
      for (const t of top) {
        const desiredMin = Number.isFinite(Number(t.scheduledDurationMin)) ? Math.max(15, Number(t.scheduledDurationMin)) : 60;
        const idx = avail2.findIndex(w => windowLengthMin(w) >= 15);
        if (idx === -1) continue;
        const w = avail2[idx];
        let slotStart = new Date(w.start);
        let actualMin = Math.min(desiredMin, windowLengthMin(w));
        // Avoid lunch overlap in fallback path as well
        const adj = shiftOutOfLunch(slotStart, actualMin);
        slotStart = adj.start; actualMin = adj.minutes;
        if (actualMin < 15) { continue; }
        const slotEnd = new Date(slotStart.getTime() + actualMin * 60000);
        const newStart = new Date(slotEnd.getTime());
        if (newStart < w.end) {
          avail2[idx] = { start: newStart, end: w.end };
        } else {
          avail2.splice(idx, 1);
        }
        const why = [];
        if (t.isImportant) why.push('important');
        if (t.isUrgent) why.push('urgent');
        if (t.deadline && slotStart > new Date(t.deadline)) {
          const hrsLate = Math.round((slotStart.getTime() - new Date(t.deadline).getTime()) / 3600000);
          why.push(`after deadline by ~${hrsLate}h`);
        }
        if (actualMin < desiredMin) why.push(`trimmed to ${actualMin}m`);
        propose.push({ task: t, start: slotStart, end: slotEnd, minutes: actualMin, why });
        if (propose.length >= 5) break;
      }
    }

    return { suggestions: propose, debug: { windows: sizedWindows.length, openTasks: openTasks.length } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, tasksKey]);

  // Use local day key from helpers

  const grouped = React.useMemo(() => {
    const map = new Map();
    // Helper to check if event is multi-day
    const isMultiDay = (e) => {
      if (!e.start || !e.end) return false;
      const start = new Date(e.start);
      const end = new Date(e.end);
      // Check if duration > 24h OR starts and ends on different days
      const durationMs = end.getTime() - start.getTime();
      const moreThan24h = durationMs > 24 * 60 * 60 * 1000;
      const differentDays = start.getDate() !== end.getDate() ||
                            start.getMonth() !== end.getMonth() ||
                            start.getFullYear() !== end.getFullYear();
      return moreThan24h || (differentDays && e.allDay);
    };
    // Calendar events (filter multi-day if option enabled AND filter hidden calendars)
    const eventItems = events
      .filter((e) => !hideMultiDay || !isMultiDay(e))
      .filter((e) => !hiddenCalendars.includes(e.calendarId))
      .map((e) => {
        // Find calendar color
        const calendar = availableCalendars.find(cal => cal.id === e.calendarId);
        return {
          type: 'event',
          _id: e._id,
          title: e.title || 'Busy',
          start: e.start ? new Date(e.start) : null,
          end: e.end ? new Date(e.end) : null,
          allDay: !!e.allDay,
          location: e.location,
          calendarColor: calendar?.backgroundColor,
        };
      });
    // Scheduled tasks (accepted)
    const scheduledItems = tasks
      .filter((t) => !!t.scheduledAt)
      .map((t) => {
        const start = new Date(t.scheduledAt);
        const minutes = Number.isFinite(Number(t.scheduledDurationMin)) ? Math.max(15, Number(t.scheduledDurationMin)) : 60;
        const end = new Date(start.getTime() + minutes * 60000);
        return { type: 'task-scheduled', _id: `sched-${t._id}`, title: t.title || 'Task', start, end, minutes, task: t };
      });
    // Suggested tasks (not yet accepted)
    const suggestedItems = (suggestions || []).map((s) => ({
      type: 'task-suggested', _id: `suggest-${s.task._id}`, title: s.task.title || 'Task', start: s.start, end: s.end, minutes: s.minutes, why: s.why, task: s.task, needsEstimate: s.needsEstimate
    }));

    const all = [...eventItems, ...scheduledItems, ...suggestedItems].filter(it => it.start);
    for (const it of all) {
      const key = localDayKey(it.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    Array.from(map.values()).forEach((arr) => arr.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0)));
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  /* eslint-disable react-hooks/exhaustive-deps */
  }, [
    eventsKey,
    hideMultiDay,
    JSON.stringify(hiddenCalendars),
    JSON.stringify(availableCalendars),
    React.useMemo(() => (tasks || []).map(t => `${t?._id || ''}:${t?.scheduledAt || ''}:${t?.scheduledDurationMin || ''}`).join('|'), [tasks]),
    React.useMemo(() => (suggestions || []).map(s => `${s?.task?._id || ''}:${s?.start?.toISOString?.() || ''}:${s?.end?.toISOString?.() || ''}:${s?.minutes || ''}`).join('|'), [suggestions]),
    localDayKey
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const formatDow = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
  const formatDuration = (ev) => {
    if (ev?.allDay) return 'all-day';
    const start = ev?.start ? new Date(ev.start) : null;
    const end = ev?.end ? new Date(ev.end) : null;
    if (!start || !end) return '';
    const ms = end.getTime() - start.getTime();
    if (!(ms > 0)) return '';
    let mins = Math.round(ms / 60000);
    const days = Math.floor(mins / (60 * 24));
    mins -= days * 60 * 24;
    const hours = Math.floor(mins / 60);
    mins = mins % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (mins || parts.length === 0) parts.push(`${mins}m`);
    return parts.join(' ');
  };

  const acceptSuggestion = (s) => {
    const { task, start, minutes } = s;
    const end = new Date(start.getTime() + minutes * 60000);

    // First, create event in Google Calendar
    Meteor.call('calendar.google.createEvent', {
      summary: task.title,
      description: task.notes || '',
      start: start.toISOString(),
      end: end.toISOString()
    }, (gcalErr, gcalResult) => {
      if (gcalErr) {
        notify({ message: gcalErr?.reason || gcalErr?.message || 'Failed to create Google Calendar event', kind: 'error' });
        return;
      }

      // Store Google Calendar event ID in task
      const fields = {
        scheduledAt: start,
        scheduledDurationMin: minutes,
        googleCalendarEventId: gcalResult?.eventId
      };

      // Then, update task in Panorama
      Meteor.call('tasks.update', task._id, fields, (err) => {
        if (err) {
          notify({ message: err?.reason || err?.message || 'Schedule failed', kind: 'error' });
          return;
        }

        // Finally, create alarm
        Meteor.call('alarms.insert', {
          title: `Task: ${task.title}`,
          nextTriggerAt: start,
          enabled: true,
          recurrence: { type: 'none' }
        }, (alarmErr) => {
          if (alarmErr) {
            notify({ message: 'Task scheduled, but alarm failed', kind: 'warning' });
            return;
          }
          notify({ message: 'Task scheduled and added to Google Calendar', kind: 'success' });
        });
      });
    });
  };

  const setTaskEstimate = (taskId, minutes) => {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) { notify({ message: 'Invalid duration', kind: 'error' }); return; }
    Meteor.call('tasks.update', taskId, { scheduledDurationMin: m }, (err) => {
      if (err) { notify({ message: err?.reason || err?.message || 'Failed to set duration', kind: 'error' }); return; }
      notify({ message: `Duration set to ${m}m`, kind: 'success' });
    });
  };

  const unscheduleTask = (taskId) => {
    // Find the task to get googleCalendarEventId
    const task = tasks.find(t => t._id === taskId);
    const googleEventId = task?.googleCalendarEventId;

    // Delete from Google Calendar if event ID exists
    if (googleEventId) {
      Meteor.call('calendar.google.deleteEvent', googleEventId, (gcalErr) => {
        if (gcalErr) {
          notify({ message: 'Failed to delete from Google Calendar: ' + (gcalErr?.reason || gcalErr?.message), kind: 'warning' });
        }

        // Still unschedule in Panorama even if Google Calendar delete fails
        Meteor.call('tasks.update', taskId, { scheduledAt: null, googleCalendarEventId: null }, (err) => {
          if (err) {
            notify({ message: err?.reason || err?.message || 'Failed to unschedule', kind: 'error' });
            return;
          }
          notify({ message: 'Unscheduled and removed from Google Calendar', kind: 'success' });
        });
      });
    } else {
      // No Google Calendar event, just unschedule in Panorama
      Meteor.call('tasks.update', taskId, { scheduledAt: null }, (err) => {
        if (err) {
          notify({ message: err?.reason || err?.message || 'Failed to unschedule', kind: 'error' });
          return;
        }
        notify({ message: 'Unscheduled', kind: 'success' });
      });
    }
  };

  const markTaskDone = (taskId) => {
    Meteor.call('tasks.update', taskId, { status: 'done' }, (err) => {
      if (err) { notify({ message: err?.reason || err?.message || 'Failed to mark done', kind: 'error' }); return; }
      notify({ message: 'Task marked done', kind: 'success' });
    });
  };

  const bumpDeadline6h = (taskId) => {
    const next = new Date(Date.now() + 6 * 60 * 60 * 1000);
    Meteor.call('tasks.update', taskId, { deadline: next }, (err) => {
      if (err) { notify({ message: err?.reason || err?.message || 'Failed to update deadline', kind: 'error' }); return; }
      notify({ message: 'Deadline +6h', kind: 'success' });
    });
  };

  if (sub() || subTasksOpen() || subTasksScheduled() || subProjects()) return <div>Loading…</div>;
  return (
    <div className="calendarPage">
      <div className="calendarToolbar">
        <button className="btn" disabled={syncing} onClick={onSync}>{syncing ? 'Syncing…' : 'Sync events'}</button>
        <button type="button" className="btn ml8" onClick={() => setShowRaw(v => !v)}>{showRaw ? 'Hide raw' : 'Show raw'}</button>
        <button type="button" className="btn ml8" onClick={() => setShowCalendarFilters(v => !v)}>
          {showCalendarFilters ? 'Hide calendars' : 'Show calendars'}
        </button>
        <label style={{ marginLeft: '16px', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hideMultiDay}
            onChange={(e) => {
              const val = e.target.checked;
              setHideMultiDay(val);
              try {
                localStorage.setItem('calendar_hide_multi_day', String(val));
              } catch (err) {
                console.warn('[calendar] localStorage write failed', err);
              }
            }}
            style={{ marginRight: '6px' }}
          />
          <span>Hide multi-day events</span>
        </label>
        {debug?.openTasks !== undefined ? (
          <span style={{ marginLeft: '16px', fontSize: '12px', color: '#6b7280' }}>
            {debug.openTasks} tasks · {debug.windows} free slots
          </span>
        ) : null}
      </div>
      {showCalendarFilters && (
        <div style={{
          marginTop: '16px',
          padding: '16px',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Calendars</h3>
            <button
              className="btn ml8"
              disabled={loadingCalendars}
              onClick={loadCalendars}
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              {loadingCalendars ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {availableCalendars.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
              {loadingCalendars ? 'Loading calendars…' : 'No calendars found'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {availableCalendars.map((cal) => {
                const isHidden = hiddenCalendars.includes(cal.id);
                return (
                  <label
                    key={cal.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      padding: '8px',
                      borderRadius: '4px',
                      background: isHidden ? 'transparent' : 'var(--bg-primary)',
                      border: `1px solid ${isHidden ? 'var(--border)' : 'var(--primary)'}`
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleCalendarVisibility(cal.id)}
                      style={{ marginRight: '8px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: cal.primary ? 'bold' : 'normal',
                        color: isHidden ? 'var(--muted)' : 'var(--text-primary)'
                      }}>
                        {cal.summary}{cal.primary ? ' (Primary)' : ''}
                      </div>
                      {cal.description && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                          {cal.description}
                        </div>
                      )}
                    </div>
                    {cal.backgroundColor && (
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: cal.backgroundColor,
                          marginLeft: '8px'
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
      <ProjectFilters
        projects={projects}
        storageKey="calendar_proj_filters"
        onChange={(next) => setProjFilters(next || {})}
      />
      {showRaw ? (
        <pre ref={rawRef} className="calRaw" aria-label="Raw events JSON" tabIndex={-1}>{rawJson}</pre>
      ) : null}
      {/* Inline suggestions are rendered inside the timeline below */}
      {grouped.length === 0 ? (
        <div className="muted">No upcoming events</div>
      ) : (
        <div className="calendarList">
          {grouped.map(([date, items]) => (
            <div key={date} className="calendarGroup">
              <div className="calDate"><span className="calDow">{formatDow(date)}</span><span className="calDateText">{date}</span></div>
              <ul className="calItems">
                {(() => {
                  const now = new Date();
                  const todayKey = localDayKey(now);
                  let list = items;
                  if (date === todayKey) {
                    const augmented = [];
                    let inserted = false;
                    for (const it of items) {
                      const st = it.start ? new Date(it.start) : null;
                      if (!inserted && st && st >= now) {
                        augmented.push({ type: 'now-line', _id: `now-${todayKey}` });
                        inserted = true;
                      }
                      augmented.push(it);
                    }
                    if (!inserted) augmented.push({ type: 'now-line', _id: `now-${todayKey}-end` });
                    list = augmented;
                  }
                  return list.map((it) => {
                    if (it.type === 'now-line') {
                      return (<li key={it._id} className="calNowLine" aria-label="Now" />);
                    }
                  if (it.type === 'event') {
                    const evt = events.find(e => e._id === it._id);
                    return (
                      <li
                        key={it._id}
                        className="calItem"
                        style={{
                          borderLeft: it.calendarColor ? `4px solid ${it.calendarColor}` : undefined,
                          paddingLeft: it.calendarColor ? '12px' : undefined
                        }}
                      >
                        <span className="calTime">{it.start ? new Date(it.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                        <span className="calTitle">{it.title || 'Busy'}</span>
                        {(() => { const d = formatDuration(it); return d ? <span className="calDur">· {d}</span> : null; })()}
                        {it.location ? <span className="calLoc">· {it.location}</span> : null}
                        {evt?.attendees?.length > 0 ? <span className="calMuted">· {evt.attendees.length} attendee{evt.attendees.length > 1 ? 's' : ''}</span> : null}
                        {evt?.conferenceData?.entryPoints?.length > 0 ? (
                          <a href={evt.conferenceData.entryPoints[0].uri} target="_blank" rel="noopener noreferrer" className="calLink ml8">Join</a>
                        ) : null}
                        {evt?.htmlLink ? (
                          <a href={evt.htmlLink} target="_blank" rel="noopener noreferrer" className="calLink ml8">View</a>
                        ) : null}
                      </li>
                    );
                  }
                  if (it.type === 'task-scheduled') {
                    return (
                      <li key={it._id} className="calItem calTask calTaskScheduled">
                        <span className="calTime">{new Date(it.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="calTitle">{it.title}</span>
                        <span className="calDur">· {Math.round((new Date(it.end).getTime() - new Date(it.start).getTime())/60000)}m</span>
                        <span className="calBadge">Scheduled</span>
                        <button className="btn ml8" onClick={() => unscheduleTask(it.task?._id || (it._id||'').replace(/^sched-/, ''))}>Unschedule</button>
                        <button className="btn ml8" onClick={() => markTaskDone(it.task?._id || (it._id||'').replace(/^sched-/, ''))}>Done</button>
                        <button className="btn ml8" onClick={() => bumpDeadline6h(it.task?._id || (it._id||'').replace(/^sched-/, ''))}>Due +6h</button>
                      </li>
                    );
                  }
                  // task-suggested
                  return (
                    <li key={it._id} className="calItem calTask calTaskSuggested">
                      <span className="calTime">{new Date(it.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="calTitle">{it.title}</span>
                      {!it.needsEstimate ? (
                        <>
                          <span className="calDur">· {Math.round((new Date(it.end).getTime() - new Date(it.start).getTime())/60000)}m</span>
                          <button className="btn ml8" onClick={() => setEditEstimateTaskId(it.task._id)}>Change</button>
                        </>
                      ) : null}
                      {it.needsEstimate || editEstimateTaskId === it.task._id ? (
                        <span className="calEstimate ml8">
                          <span className="calWhy">Estimate:</span>
                          <button className="btn ml8" onClick={() => { setTaskEstimate(it.task._id, 15); setEditEstimateTaskId(''); }}>15m</button>
                          <button className="btn ml8" onClick={() => { setTaskEstimate(it.task._id, 30); setEditEstimateTaskId(''); }}>30m</button>
                          <button className="btn ml8" onClick={() => { setTaskEstimate(it.task._id, 60); setEditEstimateTaskId(''); }}>1h</button>
                        </span>
                      ) : null}
                      {Array.isArray(it.why) && it.why.length > 0 ? (<span className="calWhy">· {it.why.join(' · ')}</span>) : null}
                      {!it.needsEstimate && editEstimateTaskId !== it.task._id ? (
                        <>
                          <button className="btn ml8" onClick={() => acceptSuggestion({ task: it.task, start: it.start, end: it.end, minutes: it.minutes, why: it.why })}>Accept</button>
                          <button className="btn ml8" onClick={() => markTaskDone(it.task._id)}>Done</button>
                          <button className="btn ml8" onClick={() => bumpDeadline6h(it.task._id)}>Due +6h</button>
                        </>
                      ) : null}
                    </li>
                  );
                  });
                })()}
              </ul>
            </div>
          ))}
        </div>
      )}
      
    </div>
  );
};

export default CalendarPage;


