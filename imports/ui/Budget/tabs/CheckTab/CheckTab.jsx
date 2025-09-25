import React from 'react';
import PropTypes from 'prop-types';
import { BudgetToolbar } from '/imports/ui/Budget/components/BudgetToolbar/BudgetToolbar.jsx';
import { fmtDisplayNoCents, fmtCopyNoCents } from '/imports/ui/Budget/utils/formatters.js';
import { filterByQuery } from '/imports/ui/Budget/utils/filters.js';
import { Meteor } from 'meteor/meteor';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';

// Notes Editor Component (reused from RecentLinesTab)
const NotesEditor = ({ lineId, initialNotes, setToast }) => {
  const [notes, setNotes] = React.useState(initialNotes);
  const [isEditing, setIsEditing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    
    Meteor.call('budget.setNotes', lineId, notes, (err, res) => {
      setIsSaving(false);
      if (err) {
        console.error('budget.setNotes failed', err);
        setToast({ message: 'Failed to save notes', kind: 'error' });
        return;
      }
      setIsEditing(false);
      setToast({ message: 'Notes saved', kind: 'success' });
    });
  };

  const handleCancel = () => {
    setNotes(initialNotes);
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div style={{ minWidth: '200px' }}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add notes..."
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '4px',
            border: '1px solid var(--border)',
            borderRadius: '3px',
            fontSize: '12px',
            resize: 'vertical',
            background: '#0e1420',
            color: 'var(--text)'
          }}
          autoFocus
        />
        <div style={{ marginTop: '4px' }}>
          <button
            className="btn"
            onClick={handleSave}
            disabled={isSaving}
            style={{ fontSize: '11px', padding: '2px 6px' }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="btn ml4"
            onClick={handleCancel}
            disabled={isSaving}
            style={{ fontSize: '11px', padding: '2px 6px' }}
          >
            Cancel
          </button>
        </div>
        <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
          Ctrl+Enter to save, Esc to cancel
        </div>
      </div>
    );
  }

  return (
    <button 
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => e.key === 'Enter' && setIsEditing(true)}
      style={{
        minWidth: '200px',
        minHeight: '20px',
        padding: '4px',
        border: '1px dashed var(--border)',
        borderRadius: '3px',
        cursor: 'pointer',
        fontSize: '12px',
        backgroundColor: notes ? '#10141b' : '#0e1420',
        color: 'var(--text)',
        textAlign: 'left',
        width: '100%'
      }}
      title={notes ? `Notes: ${notes}` : 'Click to add notes'}
    >
      {notes || 'Click to add notes...'}
    </button>
  );
};

NotesEditor.propTypes = {
  lineId: PropTypes.string.isRequired,
  initialNotes: PropTypes.string,
  setToast: PropTypes.func.isRequired
};

export const CheckTab = ({ rows, filter, teamFilter, search, onFilterChange, onTeamChange, onSearchChange, setToast }) => {
  // Local search (vendor) on top of provided rows
  const searched = filterByQuery(rows, search);
  // Option: ignore dates when grouping duplicates
  const [ignoreDates, setIgnoreDates] = React.useState(() => {
    const raw = localStorage.getItem('budget.checkIgnoreDates');
    return raw ? raw === '1' : false;
  });
  React.useEffect(() => {
    localStorage.setItem('budget.checkIgnoreDates', ignoreDates ? '1' : '0');
  }, [ignoreDates]);
  // Identify duplicate groups (date+vendor+amount) or (vendor+amount) when ignoreDates
  const groups = new Map();
  for (const r of searched) {
    const date = String(r.date || '').slice(0, 10);
    const vendorKey = String(r.vendor || '').trim().toLowerCase();
    const amt = Number(r.amountCents || 0);
    if (!vendorKey) continue;
    const key = ignoreDates ? `${vendorKey}|${amt}` : `${date}|${vendorKey}|${amt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // Flatten only groups with more than one line
  const lines = Array.from(groups.values())
    .filter(arr => Array.isArray(arr) && arr.length > 1)
    .flat()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.vendor || '').localeCompare(String(b.vendor || '')) || Number(b.amountCents || 0) - Number(a.amountCents || 0));

  return (
    <div className="panel">
      <div className="sectionBar">
        <h3>Check — Potential duplicates</h3>
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
              <option value="lemapp">LEMAPP</option>
              <option value="sre">SRE</option>
              <option value="data">DATA</option>
              <option value="pony">PONY</option>
              <option value="cto">CTO</option>
              <option value="review">To review</option>
            </select>
          </label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input className="budgetSearch" placeholder="Search vendor" value={search} onChange={(e) => onSearchChange(e.target.value)} />
            {search ? (
              <button
                className="btn"
                title="Clear"
                onClick={() => onSearchChange('')}
                style={{ padding: '4px 8px' }}
              >
                ×
              </button>
            ) : null}
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={ignoreDates}
              onChange={(e) => setIgnoreDates(!!e.target.checked)}
            />
            Ignore dates (group by vendor + amount)
          </label>
        </BudgetToolbar>
      </div>
      <div className="sectionActions">
        <button className="btn" onClick={async () => {
          const header = 'date\tvendor\tamount\tcurrency';
          const text = [header, ...lines.map(r => `${String(r.date || '').slice(0,10)}\t${String(r.vendor || '')}\t${fmtCopyNoCents(r.amountCents)}\t${r.currency || 'EUR'}`)].join('\n');
          await writeClipboard(text);
        }}>Copy</button>
      </div>
      {lines.length > 0 ? (
        <>
          <div className="tableMeta">{`${lines.length} line${lines.length === 1 ? '' : 's'} flagged as potential duplicates`}</div>
          <div className="reportTable scrollArea">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Amount TTC</th>
                  <th>Currency</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((r) => (
                  <tr key={`${r._id}`}>
                    <td>{String(r.date || '').slice(0,10)}</td>
                    <td>
                      <button
                        className="linkLike"
                        onClick={() => onSearchChange(String(r.vendor || ''))}
                        title="Filter by this vendor"
                        style={{ background: 'none', border: 'none', padding: 0, color: '#0b76da', cursor: 'pointer' }}
                      >
                        {String(r.vendor || '')}
                      </button>
                    </td>
                    <td>{fmtDisplayNoCents(r.amountCents)}</td>
                    <td>{r.currency || 'EUR'}</td>
                    <td>
                      <NotesEditor 
                        lineId={r._id} 
                        initialNotes={r.notes || ''} 
                        setToast={setToast}
                      />
                    </td>
                    <td>
                      <button
                        className="btn danger"
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
      ) : <p className="muted">No potential duplicates found for current filters.</p>}
    </div>
  );
};

export default CheckTab;

CheckTab.propTypes = {
  rows: PropTypes.array.isRequired,
  filter: PropTypes.string.isRequired,
  teamFilter: PropTypes.string.isRequired,
  search: PropTypes.string.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  onTeamChange: PropTypes.func.isRequired,
  onSearchChange: PropTypes.func.isRequired,
  setToast: PropTypes.func.isRequired,
};


