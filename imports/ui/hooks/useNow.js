import { useEffect, useState } from 'react';

/**
 * Ticking clock for time-dependent rendering (e.g. a snoozed task that must
 * reappear once its wake-up date has passed). Returns the current timestamp
 * in milliseconds, refreshed every `intervalMs`.
 */
export const useNow = (intervalMs = 60000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
