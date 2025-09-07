import React from 'react';
import PropTypes from 'prop-types';
import './VendorsTotalsTab.css';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { fmtDisplayNoCents, fmtCopyNoCents } from '/imports/ui/Budget/utils/formatters.js';
import { filterByQuery, applyDepartmentFilter, applyTeamFilter } from '/imports/ui/Budget/utils/filters.js';
import { vendorTotals } from '/imports/ui/Budget/utils/aggregations.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { Meteor } from 'meteor/meteor';

export const VendorsTotalsTab = ({ rows, filter, teamFilter, sort, dateRange, search, onFilterChange, onTeamChange, onSortChange, onDateRangeChange, onSearchChange, setToast }) => {
  let totals = vendorTotals(rows);
  if (sort === 'amount-desc') {
    totals.sort((a, b) => Number(b.total) - Number(a.total) || a.vendor.localeCompare(b.vendor));
  } else if (sort === 'amount-asc') {
    totals.sort((a, b) => Number(a.total) - Number(b.total) || a.vendor.localeCompare(b.vendor));
  } else {
    totals.sort((a, b) => a.vendor.localeCompare(b.vendor));
  }
  const grandTotal = totals.reduce((acc, t) => acc + (Number(t.total) || 0), 0);

  return (
    <div className="panel">
      <div className="sectionBar">
        <h3>Vendor totals</h3>
        <BudgetToolbar>
          <label>
            <span className="mr4">Filter:</span>
            <select className="budgetSelect" value={filter} onChange={(e) => onFilterChange(e.target.value)}>
              <option value="all">All</option>
              <option value="techOnly">Tech</option>
              <option value="parked">Parked</option>
              <option value="review">To review</option>
            </select>
          </label>
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
          <label>
            <span className="mr4">Sort:</span>
            <select className="budgetSelect" value={sort} onChange={(e) => onSortChange(e.target.value)}>
              <option value="name">Name (A–Z)</option>
              <option value="amount-desc">Amount (high → low)</option>
              <option value="amount-asc">Amount (low → high)</option>
            </select>
          </label>
          <label>
            <span className="mr4">Team:</span>
            <select className="budgetSelect" value={teamFilter} onChange={(e) => onTeamChange(e.target.value)}>
              <option value="all">All teams</option>
              <option value="lemapp">LEMAPP</option>
              <option value="sre">SRE</option>
              <option value="data">DATA</option>
              <option value="pony">PONY</option>
              <option value="cto">CTO</option>
              <option value="review">To review</option>
            </select>
          </label>
          <input className="budgetSearch" placeholder="Search vendor" value={search} onChange={(e) => onSearchChange(e.target.value)} />
        </BudgetToolbar>
      </div>
      <div className="sectionActions">
        <button className="btn" onClick={async () => {
          const sortWithin = (arr) => {
            if (sort === 'amount-desc') arr.sort((a, b) => Number(b.total) - Number(a.total) || a.vendor.localeCompare(b.vendor));
            else if (sort === 'amount-asc') arr.sort((a, b) => Number(a.total) - Number(b.total) || a.vendor.localeCompare(b.vendor));
            else arr.sort((a, b) => a.vendor.localeCompare(b.vendor));
          };
          const teamsOrder = ['lemapp','sre','data','pony','cto','-'];
          const byTeam = new Map();
          for (const t of totals) {
            const key = (t.team || '-').toLowerCase();
            const bucket = byTeam.get(key) || [];
            bucket.push(t);
            byTeam.set(key, bucket);
          }
          const ordered = [];
          for (const key of teamsOrder) {
            if (!byTeam.has(key)) continue;
            const bucket = byTeam.get(key);
            sortWithin(bucket);
            ordered.push(...bucket);
          }
          for (const [key, bucket] of byTeam.entries()) {
            if (teamsOrder.includes(key)) continue;
            sortWithin(bucket);
            ordered.push(...bucket);
          }
          const header = 'Vendor\tTotal TTC\tCount\tTeam';
          const text = [header, ...ordered.map(t => `${t.vendor}\t${fmtCopyNoCents(t.total)}\t${t.count}\t${t.team ? t.team.toUpperCase() : '-'}`)].join('\n');
          await writeClipboard(text);
        }}>Copy</button>
      </div>
      {totals && totals.length > 0 ? (
        <div className="tableMeta">Grand total: {fmtDisplayNoCents(grandTotal)}</div>
      ) : null}
      {totals && totals.length > 0 ? (
        <div className="reportTable scrollArea">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Total TTC</th>
                <th>Count</th>
                <th>Team</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={`all-${t.vendor}`}>
                  <td>{t.vendor}</td>
                  <td>{fmtDisplayNoCents(t.total)}</td>
                  <td>{t.count}</td>
                  <td>{t.team ? t.team.toUpperCase() : '—'}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => {
                        if (!t.sampleId) { setToast({ message: 'No sample line', kind: 'error' }); return; }
                        Meteor.call('budget.setDepartment', t.sampleId, 'parked', (err, res) => {
                          if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Park failed', kind: 'error' }); return; }
                          const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                          setToast({ message: n > 0 ? `Parked ${n + 1} lines for ${t.vendor}` : `Parked 1 line for ${t.vendor}` , kind: 'info' });
                        });
                      }}
                    >
                      Park
                    </button>
                    <button
                      className="btn ml8"
                      onClick={() => {
                        if (!t.sampleId) { setToast({ message: 'No sample line', kind: 'error' }); return; }
                        Meteor.call('budget.setDepartment', t.sampleId, 'tech', (err, res) => {
                          if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Mark tech failed', kind: 'error' }); return; }
                          const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                          setToast({ message: n > 0 ? `Marked ${n + 1} lines as Tech for ${t.vendor}` : `Marked 1 line as Tech for ${t.vendor}`, kind: 'success' });
                        });
                      }}
                    >
                      Tech
                    </button>
                    {['lemapp','sre','data','pony','cto'].map((teamKey) => (
                      <button
                        key={`team-${teamKey}`}
                        className="btn ml8"
                        onClick={() => {
                          if (!t.sampleId) { setToast({ message: 'No sample line', kind: 'error' }); return; }
                          Meteor.call('budget.setTeam', t.sampleId, teamKey, (err, res) => {
                            if (err) { console.error('budget.setTeam failed', err); setToast({ message: 'Set team failed', kind: 'error' }); return; }
                            const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                            setToast({ message: n > 0 ? `Assigned ${n + 1} lines to ${teamKey.toUpperCase()}` : `Assigned 1 line to ${teamKey.toUpperCase()}`, kind: 'success' });
                          });
                        }}
                      >
                        {teamKey.toUpperCase()}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No data</p>}
    </div>
  );
};

export default VendorsTotalsTab;

VendorsTotalsTab.propTypes = {
  rows: PropTypes.array.isRequired,
  filter: PropTypes.string.isRequired,
  teamFilter: PropTypes.string.isRequired,
  sort: PropTypes.string.isRequired,
  dateRange: PropTypes.string.isRequired,
  search: PropTypes.string.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  onSortChange: PropTypes.func.isRequired,
  onDateRangeChange: PropTypes.func.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


