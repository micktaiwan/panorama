const ALLOWED_TEAMS = ['lemapp','sre','data','pony','cto'];

export const filterByQuery = (rows, query) => {
  const s = String(query || '').trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) =>
    String(r.vendor || '').toLowerCase().includes(s)
  );
};

export const applyDepartmentFilter = (rows, departmentFilter) => {
  if (departmentFilter === 'parked') return rows.filter((r) => r.department === 'parked');
  if (departmentFilter === 'techOnly') return rows.filter((r) => r.department === 'tech');
  if (departmentFilter === 'review') return rows.filter((r) => !r.department || !['tech','parked'].includes(r.department));
  return rows;
};

export const applyTeamFilter = (rows, teamFilter) => {
  if (teamFilter === 'review') {
    return rows.filter((r) => !(r.team) || !ALLOWED_TEAMS.includes(String(r.team).toLowerCase()));
  }
  if (teamFilter && teamFilter !== 'all') {
    const t = String(teamFilter).toLowerCase();
    return rows.filter((r) => (r.team || '').toLowerCase() === t);
  }
  return rows;
};

export const getAllowedTeams = () => ALLOWED_TEAMS.slice();


export const filterByDateRange = (rows, range) => {
  const r = String(range || 'all');
  if (r === 'all') return rows;
  const toIso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  let from = '';
  let to = '';
  if (r === 'thisMonth') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    from = toIso(start); to = toIso(today);
  } else if (r === 'lastMonth') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    from = toIso(start); to = toIso(end);
  } else if (r === 'last7') {
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - 6);
    from = toIso(start); to = toIso(today);
  } else if (r === 'last30') {
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - 29);
    from = toIso(start); to = toIso(today);
  }
  if (!from && !to) return rows;
  return rows.filter((row) => {
    const ds = String(row.date || '');
    if (!ds) return false;
    if (from && ds < from) return false;
    if (to && ds > to) return false;
    return true;
  });
};

