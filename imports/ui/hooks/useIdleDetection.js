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
      if (!isAwayRef.current) {
        // Not away — just reset the idle timer
        resetTimer();
        return;
      }
      const now = Date.now();
      if (now - lastActiveCallRef.current < ACTIVE_THROTTLE_MS) return;
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
      if (isAwayRef.current) {
        goActive();
      } else {
        resetTimer();
      }
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    const opts = { passive: true };
    for (const evt of events) {
      window.addEventListener(evt, onActivity, opts);
    }

    // Start the idle timer
    resetTimer();

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, onActivity, opts);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
};
