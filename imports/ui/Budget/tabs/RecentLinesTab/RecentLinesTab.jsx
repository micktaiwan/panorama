import React from 'react';
import PropTypes from 'prop-types';
import './RecentLinesTab.css';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { fmtDisplay, fmtCopyNoCents, fmtDisplayNoCents } from '/imports/ui/Budget/utils/formatters.js';
//
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { Meteor } from 'meteor/meteor';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';

const isPdfPublicUrl = (url) => String(url || '').toLowerCase().includes('/public/invoice/pdf');

export const RecentLinesTab = ({ rows, search, onSearchChange, departmentFilter, onDeptChange, teamFilter, onTeamChange, setToast }) => {
  const totalDisplayed = rows.reduce((acc, r) => acc + (Number(r.amountCents || 0)), 0);
  return (
    <div className="panel">
      <div className="panelHeader">
        <h3 style={{ display: 'inline' }}>Recent lines</h3>
        <BudgetToolbar>
          <label>
            <span className="mr4">Filter:</span>
            <select className="budgetSelect" value={departmentFilter} onChange={(e) => onDeptChange(e.target.value)}>
              <option value="all">All</option>
              <option value="techOnly">Tech</option>
              <option value="parked">Parked</option>
              <option value="review">To review</option>
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
          const data = rows;
          const text = data.map(r => `${r.date}\t${r.vendor || ''}\t${r.department || 'tech'}\t${fmtCopyNoCents(r.amountCents)}\t${r.currency || 'EUR'}`).join('\n');
          const res = await writeClipboard(text);
          setToast({ message: res.message, kind: res.kind });
        }}>Copy</button>
      </div>
      {rows && rows.length > 0 ? (
        <>
          <div className="tableMeta">{`${rows.length} line${rows.length === 1 ? '' : 's'}`}</div>
          <div className="tableMeta"><strong>Total TTC:</strong> {fmtDisplayNoCents(totalDisplayed)}</div>
          {rows.length > 200 ? (
            <div className="tableMeta">Showing first 200 / {rows.length} rows</div>
          ) : null}
          <div className="budgetTable scrollArea">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Dept</th>
                  <th>Amount TTC</th>
                  <th>Currency</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r) => (
                  <tr key={`${r._id}`}>
                    <td>{r.date}</td>
                    <td>
                      {r.publicFileUrl ? (
                        <Tooltip
                          placement="right"
                          size="large"
                          content={(
                            <span style={{ display: 'block', maxWidth: 760 }}>
                              {isPdfPublicUrl(r.publicFileUrl) ? (
                                <object data={r.publicFileUrl} type="application/pdf" width="720" height="960">
                                  <a href={r.publicFileUrl} target="_blank" rel="noreferrer">Open document</a>
                                </object>
                              ) : (
                                <img src={r.publicFileUrl} alt="preview" style={{ maxWidth: '720px', maxHeight: '960px' }} />
                              )}
                            </span>
                          )}
                        >
                          <span>{r.vendor || '—'}</span>
                        </Tooltip>
                      ) : (
                        r.vendor || '—'
                      )}
                    </td>
                    <td>{r.category || r.autoCategory || ''}</td>
                    <td>{r.department || 'tech'}</td>
                    <td>{fmtDisplay(r.amountCents)}</td>
                    <td>{r.currency || 'EUR'}</td>
                    <td>
                      {r.department === 'parked' ? (
                        <button
                          className="btn"
                          onClick={() => {
                            Meteor.call('budget.setDepartment', r._id, 'tech', (err, res) => {
                              if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Unpark failed', kind: 'error' }); return; }
                              setToast({ message: 'Unparked', kind: 'success' });
                            });
                          }}
                        >
                          Unpark
                        </button>
                      ) : (
                        <button
                          className="btn"
                          onClick={() => {
                            Meteor.call('budget.setDepartment', r._id, 'parked', (err, res) => {
                              if (err) { console.error('budget.setDepartment failed', err); setToast({ message: 'Park failed', kind: 'error' }); return; }
                              const n = (res && res.bulkUpdated) ? Number(res.bulkUpdated) : 0;
                              setToast({ message: n > 0 ? `Parked ${n + 1} lines (including similar)` : 'Parked', kind: 'info' });
                            });
                          }}
                        >
                          Park
                        </button>
                      )}
                      {r.publicFileUrl ? (
                        <a
                          className="btn ml8"
                          href={r.publicFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open document"
                        >
                          Open doc
                        </a>
                      ) : null}
                      <button
                        className="btn danger ml8"
                        onClick={() => {
                          Meteor.call('budget.removeLine', r._id, (err, res) => {
                            if (err) { console.error('budget.removeLine failed', err); setToast({ message: 'Delete failed', kind: 'error' }); return; }
                            setToast({ message: 'Line deleted', kind: 'success' });
                          });
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">No budget lines yet. Import a Pennylane file to get started.</p>
      )}
    </div>
  );
};

export default RecentLinesTab;

RecentLinesTab.propTypes = {
  rows: PropTypes.array.isRequired,
  search: PropTypes.string.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  departmentFilter: PropTypes.string.isRequired,
  onDeptChange: PropTypes.func.isRequired,
  teamFilter: PropTypes.string.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


