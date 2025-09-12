// Date/time helpers for UserLog

export function formatHms(dateLike) {
  if (!dateLike) return '';
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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


