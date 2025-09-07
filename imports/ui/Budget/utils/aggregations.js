import { yyyymm } from '/imports/ui/Budget/utils/formatters.js';

export const groupByMonthTotals = (rows) => {
  const group = new Map();
  for (const r of rows) {
    const key = yyyymm(r.date);
    const prev = group.get(key) || 0;
    group.set(key, prev + Number(r.amountCents || 0));
  }
  return Array.from(group.entries()).sort((a, b) => a[0].localeCompare(b[0]));
};

export const groupByMonthVendor = (rows) => {
  // Group by month + vendor + department + team to avoid consolidating across different classifications
  const group = new Map(); // key: `${month}|${vendor}|${deptKey}|${teamKey}` -> { total, count, sampleId, deptKey, teamKey }
  for (const r of rows) {
    const month = yyyymm(r.date);
    const vendor = (r.vendor || 'unknown').trim();
    const deptKey = String(r.department || '-').toLowerCase();
    const teamKey = String(r.team || '-').toLowerCase();
    const key = `${month}|${vendor}|${deptKey}|${teamKey}`;
    const entry = group.get(key) || { total: 0, count: 0, sampleId: null, department: deptKey === '-' ? null : deptKey, team: teamKey === '-' ? null : teamKey };
    entry.total += Number(r.amountCents || 0);
    entry.count += 1;
    if (!entry.sampleId && r._id) entry.sampleId = r._id;
    group.set(key, entry);
  }
  return Array.from(group.entries()).map(([k, v]) => {
    const [m, ven] = k.split('|');
    return { month: m, vendor: ven, total: v.total, count: v.count, sampleId: v.sampleId, team: v.team, department: v.department };
  }).sort((a, b) => (a.month === b.month ? a.vendor.localeCompare(b.vendor) : a.month.localeCompare(b.month)));
};

export const vendorTotals = (rows) => {
  const totalsMap = new Map();
  const countsMap = new Map();
  const sampleMap = new Map();
  const teamCountsMap = new Map(); // vendor -> Map(team -> count)
  for (const r of rows) {
    const vendor = (r.vendor || 'unknown').trim();
    totalsMap.set(vendor, (totalsMap.get(vendor) || 0) + Number(r.amountCents || 0));
    countsMap.set(vendor, (countsMap.get(vendor) || 0) + 1);
    if (!sampleMap.has(vendor) && r._id) sampleMap.set(vendor, r._id);
    const team = (r.team || '').toLowerCase();
    if (team) {
      const tm = teamCountsMap.get(vendor) || new Map();
      tm.set(team, (tm.get(team) || 0) + 1);
      teamCountsMap.set(vendor, tm);
    }
  }
  return Array.from(totalsMap.entries())
    .map(([vendor, total]) => {
      let domTeam = null;
      let domCount = 0;
      const tm = teamCountsMap.get(vendor);
      if (tm) {
        for (const [k, c] of tm.entries()) {
          if (c > domCount) { domCount = c; domTeam = k; }
        }
      }
      return { vendor, total, count: countsMap.get(vendor) || 0, sampleId: sampleMap.get(vendor) || null, team: domTeam };
    });
};

export const groupByMonthTeam = (rows) => {
  const map = new Map(); // key: `${month}|${teamKey}` -> total
  for (const r of rows) {
    const month = yyyymm(r.date);
    const teamKey = String(r.team || '-').toLowerCase();
    const key = `${month}|${teamKey}`;
    map.set(key, (map.get(key) || 0) + Number(r.amountCents || 0));
  }
  const items = Array.from(map.entries()).map(([k, total]) => {
    const [m, teamKey] = k.split('|');
    return { month: m, team: teamKey === '-' ? null : teamKey, total };
  });
  items.sort((a, b) => (a.month === b.month ? (a.team || '').localeCompare(b.team || '') : a.month.localeCompare(b.month)));
  return items;
};


