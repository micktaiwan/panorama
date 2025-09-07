import React from 'react';
import PropTypes from 'prop-types';
import './VendorsMonthlyTab.css';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { fmtDisplayNoCents, fmtCopyNoCents } from '/imports/ui/Budget/utils/formatters.js';
import { groupByMonthVendor, groupByMonthTotals } from '/imports/ui/Budget/utils/aggregations.js';
import { BudgetChart } from '/imports/ui/Budget/components/BudgetChart/BudgetChart.jsx';
//
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { Meteor } from 'meteor/meteor';

export const VendorsMonthlyTab = ({ rows, filter, teamFilter, search, dateRange, onFilterChange, onTeamChange, onSearchChange, onDateRangeChange, setToast }) => {
  const itemsAsc = groupByMonthVendor(rows);
  const items = itemsAsc.slice().sort((a, b) => (
    b.month.localeCompare(a.month) || (Number(b.total) - Number(a.total)) || a.vendor.localeCompare(b.vendor)
  ));
  const chartItems = groupByMonthTotals(rows);

  return (
    <div className="panel">
      <div className="sectionBar">
        <h3>Report — Monthly by vendor</h3>
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
      <BudgetChart items={chartItems} />
      <div className="sectionActions">
        <button className="btn" onClick={async () => {
          const text = items
            .map((it) => `${it.month}\t${it.vendor}${it.count > 1 ? ` (${it.count})` : ''}\t${fmtCopyNoCents(it.total)}`)
            .join('\n');
          await writeClipboard(text);
        }}>Copy</button>
      </div>
      {rows && rows.length > 0 ? (
        <>
          <div className="tableMeta">{`${items.length} group${items.length === 1 ? '' : 's'}`}</div>
          <div className="reportTable scrollArea">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Vendor</th>
                  <th>Dept</th>
                  <th>Team</th>
                  <th>Total TTC</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.month}|${it.vendor}`}>
                    <td>{it.month}</td>
                    <td>{it.count > 1 ? `${it.vendor} (${it.count})` : it.vendor}</td>
                    <td>{it.department ? it.department : '—'}</td>
                    <td>{it.team ? it.team.toUpperCase() : '—'}</td>
                    <td>{fmtDisplayNoCents(it.total)}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() => {
                          if (!it.sampleId) { setToast({ message: 'No sample line', kind: 'error' }); return; }
                          Meteor.call('budget.setDepartment', it.sampleId, 'parked', (err, res) => {
                            if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Park failed', kind: 'error' }); return; }
                            const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                            setToast({ message: n > 0 ? `Parked ${n + 1} lines for ${it.vendor}` : `Parked 1 line for ${it.vendor}` , kind: 'info' });
                          });
                        }}
                      >
                        Park
                      </button>
                      <button
                        className="btn ml8"
                        onClick={() => {
                          if (!it.sampleId) { setToast({ message: 'No sample line', kind: 'error' }); return; }
                          Meteor.call('budget.setDepartment', it.sampleId, 'tech', (err, res) => {
                            if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Mark tech failed', kind: 'error' }); return; }
                            const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                            setToast({ message: n > 0 ? `Marked ${n + 1} lines as Tech for ${it.vendor}` : `Marked 1 line as Tech for ${it.vendor}`, kind: 'success' });
                          });
                        }}
                      >
                        Tech
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="muted">No data</p>}
    </div>
  );
};

export default VendorsMonthlyTab;

VendorsMonthlyTab.propTypes = {
  rows: PropTypes.array.isRequired,
  filter: PropTypes.string.isRequired,
  teamFilter: PropTypes.string.isRequired,
  search: PropTypes.string.isRequired,
  dateRange: PropTypes.string.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  onDateRangeChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


