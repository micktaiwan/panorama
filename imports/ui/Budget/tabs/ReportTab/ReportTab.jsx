import React from 'react';
import PropTypes from 'prop-types';
import './ReportTab.css';
import { BudgetChart } from '/imports/ui/Budget/components/BudgetChart/BudgetChart.jsx';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { BudgetFilters } from '/imports/ui/Budget/components/BudgetFilters/BudgetFilters.jsx';
import { fmtDisplayNoCents, fmtCopyNoCents } from '/imports/ui/Budget/utils/formatters.js';
import { groupByMonthTotals } from '/imports/ui/Budget/utils/aggregations.js';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';

export const ReportTab = ({ rows, filter, teamFilter, search, onFilterChange, onTeamChange, onSearchChange, _setToast }) => {

  const items = groupByMonthTotals(rows);

  const vendors = rows.map(r => String(r.vendor || '').trim()).filter(Boolean);
  const labelSet = new Set(vendors);
  const labelCount = labelSet.size;
  const labelList = Array.from(labelSet).slice(0, 10);

  return (
    <div className="panel">
      <div className="sectionBar">
        <h3>Report — Monthly totals</h3>
        <BudgetToolbar>
          <BudgetFilters
            departmentEnabled
            teamEnabled
            searchEnabled
            departmentValue={filter}
            onDepartmentChange={onFilterChange}
            teamValue={teamFilter}
            onTeamChange={onTeamChange}
            searchValue={search}
            onSearchChange={onSearchChange}
          />
        </BudgetToolbar>
      </div>
      <div className="sectionActions">
        <button className="btn" onClick={async () => {
          const text = items.map(([m, v]) => `${m}\t${fmtCopyNoCents(v)}`).join('\n');
          await writeClipboard(text);
        }}>Copy</button>
      </div>
      {rows && rows.length > 0 ? (
        <>
          <div className="tableMeta">{`${items.length} month${items.length === 1 ? '' : 's'}`}</div>
          <div className="tableMeta">
            {`Matching vendors: ${labelCount}`} {' '}
            {labelCount > 0 && labelCount <= 10 ? (
              <span className="inlineList"> {labelList.join(' | ')}</span>
            ) : null}
          </div>
          <BudgetChart items={items} />
          <div className="reportTable scrollArea">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Total TTC</th>
                </tr>
              </thead>
              <tbody>
                {items.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{fmtDisplayNoCents(v)}</td>
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

export default ReportTab;

ReportTab.propTypes = {
  rows: PropTypes.array.isRequired,
  filter: PropTypes.string.isRequired,
  teamFilter: PropTypes.string.isRequired,
  search: PropTypes.string.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


