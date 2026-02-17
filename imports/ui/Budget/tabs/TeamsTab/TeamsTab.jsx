import React from 'react';
import PropTypes from 'prop-types';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { fmtDisplayNoCents, fmtCopyNoCents } from '/imports/ui/Budget/utils/formatters.js';
import { groupByMonthTeam } from '/imports/ui/Budget/utils/aggregations.js';
import { applyDepartmentFilter, applyTeamFilter, filterByQuery, filterByDateRange } from '/imports/ui/Budget/utils/filters.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { BudgetChart } from '/imports/ui/Budget/components/BudgetChart/BudgetChart.jsx';
import { TeamFilters } from '/imports/ui/Budget/components/TeamFilters/TeamFilters.jsx';

const getArr = () => {
  try { const v = localStorage.getItem('budget.arr'); return Number(v || 0); } catch { return 0; }
};

export const TeamsTab = ({ rows, filter, teamFilter, search, dateRange, onFilterChange, onTeamChange, onDateRangeChange, onSearchChange, _setToast }) => {
  const [teamTriState, setTeamTriState] = React.useState({});
  // Reuse same filter logic as other tabs
  let filtered = applyDepartmentFilter(rows, filter);
  if (teamFilter !== 'consolidated') {
    filtered = applyTeamFilter(filtered, teamFilter);
  }
  if (teamFilter !== 'consolidated') {
    filtered = filterByQuery(filtered, search);
  }
  filtered = filterByDateRange(filtered, dateRange);
  // Apply tri-state team filters
  const hasInclude = Object.values(teamTriState).some((v) => v === 1);
  if (hasInclude || Object.keys(teamTriState).length > 0) {
    filtered = filtered.filter((r) => {
      const key = String(r.team || '').toLowerCase();
      const state = teamTriState[key];
      if (hasInclude) return state === 1; // only included
      if (state === -1) return false; // exclude
      return true; // neutral
    });
  }
  let items = groupByMonthTeam(filtered);
  if (teamFilter === 'consolidated') {
    const byMonth = new Map();
    for (const it of items) {
      byMonth.set(it.month, (byMonth.get(it.month) || 0) + Number(it.total || 0));
    }
    items = Array.from(byMonth.entries()).map(([m, total]) => ({ month: m, team: null, total })).sort((a, b) => a.month.localeCompare(b.month));
  }
  const arr = getArr();

  const rowsView = items.map((it) => {
    const pct = arr > 0 ? Math.round((Number(it.total) * 12 / (arr * 100)) * 10000) / 100 : null; // annualize monthly spend (x12) before comparing to ARR; total is cents
    return { ...it, pct };
  });
  const rowsSorted = rowsView.slice().sort((a, b) => b.month.localeCompare(a.month) || (a.team || '').localeCompare(b.team || ''));
  const chartItems = (() => {
    // Aggregate all teams per month into a single % value (sum of totals / ARR)
    const byMonth = new Map();
    for (const r of rowsSorted) {
      byMonth.set(r.month, (byMonth.get(r.month) || 0) + Number(r.total || 0));
    }
    const series = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    if (arr > 0) {
      return series.map(([m, total]) => [m, Math.round((total * 12 / (arr * 100)) * 10000) / 100]);
    }
    return series.map(([m]) => [m, 0]);
  })();
  const pctFormatter = (v) => `${v}%`;
  const teamName = (t) => (t ? t.toUpperCase() : (teamFilter === 'consolidated' ? 'All teams' : '—'));

  return (
    <div className="panel">
      <div className="sectionBar">
        <h3>Teams — Monthly spend vs ARR</h3>
        <BudgetToolbar>
          <label>
            <span className="mr4">Filter:</span>
            <select className="budgetSelect" value={filter} onChange={(e) => onFilterChange(e.target.value)}>
              <option value="all">All</option>
              <option value="techOnly">Tech</option>
              <option value="product">Product</option>
              <option value="other">Other</option>
              <option value="parked">Parked</option>
              <option value="review">To review</option>
            </select>
          </label>
          <label>
            <span className="mr4">Team:</span>
            <select className="budgetSelect" value={teamFilter} onChange={(e) => onTeamChange(e.target.value)}>
              <option value="all">All teams</option>
              <option value="consolidated">Consolidated</option>
              <option value="lemapp">LEMAPP</option>
              <option value="sre">SRE</option>
              <option value="data">DATA</option>
              <option value="pony">PONY</option>
              <option value="cto">CTO</option>
              <option value="review">To review</option>
            </select>
          </label>
          <TeamFilters onChange={setTeamTriState} />
          <label>
            <span className="mr4">Date:</span>
            <select className="budgetSelect" value={dateRange} onChange={(e) => onDateRangeChange(e.target.value)}>
              <option value="all">All</option>
              <option value="thisMonth">This month</option>
              <option value="lastMonth">Last month</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
            </select>
          </label>
          <input className="budgetSearch" placeholder="Search vendor" value={search} onChange={(e) => onSearchChange(e.target.value)} />
        </BudgetToolbar>
      </div>
      <BudgetChart items={chartItems} yFormatter={pctFormatter} yLabel="% of ARR (annualized)" />
      <div className="sectionActions">
        <button className="btn" onClick={async () => {
          const header = 'Month\tTeam\tTotal TTC\t% of ARR';
          const text = [header, ...rowsSorted.map(r => `${r.month}\t${teamName(r.team)}\t${fmtCopyNoCents(r.total)}\t${r.pct !== null ? r.pct + '%' : '-'}`)].join('\n');
          await writeClipboard(text);
        }}>Copy</button>
      </div>
      {rowsSorted && rowsSorted.length > 0 ? (
        <div className="reportTable scrollArea">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Team</th>
                <th>Total TTC</th>
                <th>% of ARR</th>
              </tr>
            </thead>
            <tbody>
              {rowsSorted.map((r) => (
                <tr key={`${r.month}|${r.team || '-'}`}>
                  <td>{r.month}</td>
                  <td>{teamName(r.team)}</td>
                  <td>{fmtDisplayNoCents(r.total)}</td>
                  <td>{r.pct !== null ? `${r.pct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No data</p>}
    </div>
  );
};

export default TeamsTab;

TeamsTab.propTypes = {
  rows: PropTypes.array.isRequired,
  filter: PropTypes.string.isRequired,
  teamFilter: PropTypes.string.isRequired,
  search: PropTypes.string.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


