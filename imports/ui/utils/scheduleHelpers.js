export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;
export const LUNCH_START_HOUR = 12;
export const LUNCH_END_HOUR = 14;

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
export const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const clamp = (t, a, b) => new Date(Math.max(a.getTime(), Math.min(b.getTime(), t.getTime())));

export const localDayKey = (dateLike) => {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const isToday = (dateLike, now = new Date()) => {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

export const mergeIntervals = (list) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const x = sorted[i];
    // Only merge if there's actual overlap (not just touching)
    // Allow 1 minute tolerance for rounding
    const overlapMs = cur.end.getTime() - x.start.getTime();
    if (overlapMs > 60000) { // More than 1 minute overlap
      cur.end = new Date(Math.max(cur.end.getTime(), x.end.getTime()));
    } else {
      out.push(cur); cur = { ...x };
    }
  }
  out.push(cur);
  return out;
};

export const shiftOutOfLunch = (start, minutes, lunchStartHour = LUNCH_START_HOUR, lunchEndHour = LUNCH_END_HOUR) => {
  const day = start instanceof Date ? start : new Date(start);
  const lunchStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), lunchStartHour, 0, 0, 0);
  const lunchEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), lunchEndHour, 0, 0, 0);
  const end = new Date(day.getTime() + minutes * 60000);
  const overlaps = !(end <= lunchStart || day >= lunchEnd);
  if (!overlaps) return { start: day, minutes };
  const shiftedStart = lunchEnd;
  const shiftedMinutes = Math.max(0, minutes - Math.ceil((lunchEnd.getTime() - day.getTime()) / 60000));
  return { start: shiftedStart, minutes: shiftedMinutes };
};

export const windowLengthMin = (w) => Math.floor((w.end.getTime() - w.start.getTime()) / 60000);
