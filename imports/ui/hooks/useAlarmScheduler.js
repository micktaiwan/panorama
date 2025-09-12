import { useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { AlarmsCollection } from '/imports/api/alarms/collections';

const LEADER_KEY = 'alarms_leader_heartbeat';
const LEADER_TTL_MS = 5000;

const isLeader = () => {
  const now = Date.now();
  const val = localStorage.getItem(LEADER_KEY);
  if (!val) return false;
  const ts = parseInt(val, 10);
  return Number.isFinite(ts) && now - ts < LEADER_TTL_MS;
};

const claimLeadership = () => {
  try {
    localStorage.setItem(LEADER_KEY, String(Date.now()));
  } catch (e) {
    console.warn('useAlarmScheduler: cannot write leader heartbeat', e);
  }
};

const heartbeat = (ref) => {
  if (ref.current) clearInterval(ref.current);
  ref.current = setInterval(() => {
    claimLeadership();
  }, LEADER_TTL_MS / 2);
};

export const useAlarmScheduler = () => {
  const timeoutRef = useRef(null);
  const heartbeatRef = useRef(null);
  const scheduledRef = useRef({ alarmId: null, at: 0 });
  const alarmsRef = useRef([]);
  const scheduleFnRef = useRef(() => {});
  const schedulingRef = useRef(false);
  const debugIntervalRef = useRef(null);

  const subReady = useTracker(() => Meteor.subscribe('alarms.mine').ready(), []);
  const alarms = useTracker(() => AlarmsCollection.find({}, { sort: { snoozedUntilAt: 1, nextTriggerAt: 1 } }).fetch(), [subReady]);
  // Keep latest alarms in a ref to avoid recreating timers on every reactive change
  useEffect(() => { alarmsRef.current = alarms; }, [JSON.stringify(alarms)]);

  useEffect(() => {
    // elect a leader
    if (!isLeader()) claimLeadership();
    heartbeat(heartbeatRef);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  useEffect(() => {
    const effectiveTime = (a) => (a.snoozedUntilAt ? new Date(a.snoozedUntilAt).getTime() : new Date(a.nextTriggerAt).getTime());

    const processPastDue = (list) => {
      if (!list || list.length === 0) return Promise.resolve();
      // Process sequentially to avoid hammering the method queue
      return new Promise((resolve) => {
        let idx = 0;
        const step = () => {
          if (idx >= list.length) { resolve(); return; }
          const a = list[idx++];
          Meteor.call('alarms.markFiredIfDue', a._id, () => step());
        };
        step();
      });
    };


    const scheduleNext = () => {
      if (!isLeader()) return; // only leader schedules
      if (schedulingRef.current) return; // prevent re-entrancy
      schedulingRef.current = true;
      const now = Date.now();
      const current = alarmsRef.current || [];

      // Catch-up: fire all past-due alarms immediately (MVP disables them)
      const dueNow = current
        .filter(a => a.enabled && (a.snoozedUntilAt || a.nextTriggerAt))
        .filter(a => effectiveTime(a) <= now);

      if (dueNow.length > 0) {
        // Bound per tick to avoid too many calls
        processPastDue(dueNow.slice(0, 10)).then(() => {
          // After processing due alarms, schedule the next future one
          schedulingRef.current = false;
          setTimeout(scheduleNext, 0);
        });
        return;
      }

      // Schedule the earliest future alarm
      const upcoming = current
        .filter(a => a.enabled && (a.snoozedUntilAt || a.nextTriggerAt))
        .sort((a, b) => effectiveTime(a) - effectiveTime(b))[0];
      if (!upcoming) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
          
        }
        scheduledRef.current = { alarmId: null, at: 0 };
        schedulingRef.current = false;
        return;
      }
      const at = effectiveTime(upcoming);
      const already = scheduledRef.current;
      if (already.alarmId === upcoming._id && already.at === at && timeoutRef.current) {
        // Keep existing timer
        schedulingRef.current = false;
        return;
      }
      // Reschedule only if different target or no existing timer
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        
      }
      const delay = Math.max(0, at - now);
      scheduledRef.current = { alarmId: upcoming._id, at };
      timeoutRef.current = Meteor.setTimeout(() => {
        Meteor.call('alarms.markFiredIfDue', upcoming._id, () => {
          // Clear current schedule and compute next
          scheduledRef.current = { alarmId: null, at: 0 };
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            
          }
          schedulingRef.current = false;
          setTimeout(scheduleNext, 0);
        });
      }, delay);
      
      schedulingRef.current = false;
    };

    // expose scheduler to other effects (like alarms changes)
    scheduleFnRef.current = scheduleNext;
    scheduleNext();
    // alarms debug logging removed

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleNext();
      }
    };
    const onFocus = () => scheduleNext();
    const onOnline = () => scheduleNext();
    const onPageShow = () => scheduleNext();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    const tick = setInterval(scheduleNext, 15 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      clearInterval(tick);
      if (debugIntervalRef.current) {
        clearInterval(debugIntervalRef.current);
        debugIntervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        timersClearedRef.current += 1;
        
      }
    };
  }, []);

  // Trigger reschedule on alarms changes without re-installing timers/listeners
  useEffect(() => {
    scheduleFnRef.current();
  }, [JSON.stringify(alarms)]);
};


