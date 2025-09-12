export const addDays = (date, days) => {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
};

export const addWeeks = (date, weeks) => addDays(date, weeks * 7);

export const addMonthsPreserveTime = (date, months) => {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const hr = d.getHours();
  const mi = d.getMinutes();
  const se = d.getSeconds();
  const ms = d.getMilliseconds();
  return new Date(y, m + months, day, hr, mi, se, ms);
};

export const computeNextOccurrence = (baseDate, recurrenceType) => {
  const now = new Date();
  const recur = String(recurrenceType || 'none');
  if (recur === 'daily') {
    let next = addDays(baseDate, 1);
    // ensure strictly future
    if (next.getTime() <= now.getTime()) next = addDays(next, 1);
    return next;
  }
  if (recur === 'weekly') {
    let next = addWeeks(baseDate, 1);
    if (next.getTime() <= now.getTime()) next = addWeeks(next, 1);
    return next;
  }
  if (recur === 'monthly') {
    let next = addMonthsPreserveTime(baseDate, 1);
    if (next.getTime() <= now.getTime()) next = addMonthsPreserveTime(next, 1);
    return next;
  }
  return null;
};


