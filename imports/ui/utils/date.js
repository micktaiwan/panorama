const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit'
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit'
});

const timeFormatterSeconds = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

export const formatDate = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return dateFormatter.format(d);
};

export const formatDateTime = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return `${dateFormatter.format(d)} · ${timeFormatter.format(d)}`;
};

export const formatCompactDateTime = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  return sameDay ? timeFormatterSeconds.format(d) : `${dateFormatter.format(d)} · ${timeFormatterSeconds.format(d)}`;
};

export const timeAgo = (date) => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const future = diff < 0;
  const sAbs = Math.floor(Math.abs(diff) / 1000);
  if (future) {
    if (sAbs < 45) return 'in a few seconds';
    if (sAbs < 90) return 'in 1 min';
    const m = Math.floor(sAbs / 60);
    if (m < 45) return `in ${m} min`;
    if (m < 90) return 'in 1 hour';
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h} hours`;
    // Use calendar-based day diff to avoid 00:00 targets showing as "tomorrow"
    const startOf = (x) => { const t = new Date(x); t.setHours(0,0,0,0); return t; };
    const days = Math.round((startOf(d).getTime() - startOf(new Date()).getTime()) / 86400000);
    if (days === 1) return 'tomorrow';
    if (days < 30) return `in ${days} days`;
    const months = Math.floor(days / 30);
    if (months < 18) return `in ${months} month${months > 1 ? 's' : ''}`;
    const years = Math.floor(days / 365);
    return `in ${years} year${years > 1 ? 's' : ''}`;
  }
  const s = sAbs;
  if (s < 45) return 'just now';
  if (s < 90) return '1 min ago';
  const m = Math.floor(s / 60);
  if (m < 45) return `${m} min ago`;
  if (m < 90) return '1 hour ago';
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hours ago`;
  const startOf = (x) => { const t = new Date(x); t.setHours(0,0,0,0); return t; };
  const daysPast = Math.round((startOf(new Date()).getTime() - startOf(d).getTime()) / 86400000);
  if (daysPast === 1) return 'yesterday';
  if (daysPast < 30) return `${daysPast} days ago`;
  const months = Math.floor(daysPast / 30);
  if (months < 18) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(daysPast / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
};

export const deadlineSeverity = (deadline) => {
  if (!deadline) return '';
  const dl = deadline instanceof Date ? deadline : new Date(deadline);
  // Normalize both to local day start to avoid timezone/time-of-day skew
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dlStart = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate());
  const timeFrameInMillis = 7 * 24 * 60 * 60 * 1000; // Adjust the number of days as needed
  if (dlStart.getTime() <= todayStart.getTime()) return 'dueNow';
  if (dlStart.getTime() - todayStart.getTime() <= timeFrameInMillis) return 'dueSoon';
  return '';
};

export const timeUntilPrecise = (date) => {
  if (!date) return '';
  const target = date instanceof Date ? date : new Date(date);
  const diffMs = target.getTime() - Date.now();
  const past = diffMs < 0;
  const totalSeconds = Math.abs(Math.round(diffMs / 1000));
  
  const timeUnits = [
    { label: 'd', seconds: 86400 },
    { label: 'h', seconds: 3600 },
    { label: 'm', seconds: 60 },
    { label: 's', seconds: 1 }
  ];

  const parts = [];
  let remainingSeconds = totalSeconds;

  for (const { label, seconds } of timeUnits) {
    if (label === 'h' && totalSeconds > 864000) break; // Skip hours if more than 10 days
    if (label === 'm' && totalSeconds > 864000) break; // Skip minutes if more than 10 days
    if (label === 's' && totalSeconds > 300) break; // Skip seconds if more than 5 minutes

    const value = Math.floor(remainingSeconds / seconds);
    remainingSeconds -= value * seconds;

    if (value || parts.length) {
      parts.push(`${value}${label}`);
    }
  }

  const base = parts.join(' ');
  return past ? `${base} ago` : `in ${base}`;
};
