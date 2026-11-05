// Date/time helpers for UserLog

export function formatHms(dateLike) {
  if (!dateLike) return '';
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Moves `since` back by whole days until `entryDate` falls inside the visible range
export function sinceCoveringEntry(since, entryDate) {
  const dayMs = 24 * 3600 * 1000;
  const days = Math.max(1, Math.ceil((since.getTime() - entryDate.getTime()) / dayMs));
  return new Date(since.getTime() - days * dayMs);
}

export function hourKey(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
}

export function formatHourLabel(dateLike) {
  const base = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const d = new Date(base);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1); // display next hour bucket for descending flow
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  return `${day} · ${hh}:00`;
}


