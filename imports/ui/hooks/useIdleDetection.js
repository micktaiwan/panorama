import { useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVE_THROTTLE_MS = 30 * 1000; // 30 seconds

export const useIdleDetection = () => {
  const timerRef = useRef(null);
  const isAwayRef = useRef(false);
  const lastActiveCallRef = useRef(0);

  useEffect(() => {
    const goAway = () => {
      if (isAwayRef.current) return;
      isAwayRef.current = true;
      Meteor.call('userPresence.setAway');
    };

    const goActive = () => {
      const now = Date.now();
      if (now - lastActiveCallRef.current < ACTIVE_THROTTLE_MS) {
        resetTimer();
        return;
      }
      lastActiveCallRef.current = now;
      isAwayRef.current = false;
      Meteor.call('userPresence.setActive');
      resetTimer();
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(goAway, IDLE_TIMEOUT_MS);
    };

    const onActivity = () => {
      goActive();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        goAway();
      } else {
        goActive();
      }
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    const opts = { passive: true };
    for (const evt of events) {
      window.addEventListener(evt, onActivity, opts);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Ensure DB status is online on mount (covers HMR, reconnects, stale DB state)
    Meteor.call('userPresence.setActive');
    lastActiveCallRef.current = Date.now();
    resetTimer();

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, onActivity, opts);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
};
