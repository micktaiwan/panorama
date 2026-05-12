import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { notify } from '/imports/ui/utils/notify.js';

const FIELDS = [
  { key: 'name', label: 'First name', defaultOn: true },
  { key: 'lastName', label: 'Last name', defaultOn: true },
  { key: 'email', label: 'Email', defaultOn: true },
  { key: 'role', label: 'Role', defaultOn: true },
  { key: 'team', label: 'Team', defaultOn: true },
  { key: 'subteam', label: 'Subteam', defaultOn: false },
  { key: 'arrivalDate', label: 'Arrival date', defaultOn: false },
  { key: 'aliases', label: 'Aliases', defaultOn: false },
  { key: 'notes', label: 'Notes', defaultOn: false },
  { key: 'left', label: 'Left (flag)', defaultOn: true },
  { key: 'contactOnly', label: 'Contact only (flag)', defaultOn: true },
  { key: 'createdAt', label: 'Created at', defaultOn: false },
  { key: 'updatedAt', label: 'Updated at', defaultOn: false }
];

const LS_KEY = 'people.export.prefs';

const defaultPrefs = () => ({
  format: 'csv',
  includeLeft: false,
  includeContacts: true,
  fields: Object.fromEntries(FIELDS.map(f => [f.key, f.defaultOn]))
});

const loadPrefs = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw);
    const base = defaultPrefs();
    return {
      format: parsed.format === 'json' ? 'json' : 'csv',
      includeLeft: !!parsed.includeLeft,
      includeContacts: parsed.includeContacts !== false,
      fields: { ...base.fields, ...(parsed.fields || {}) }
    };
  } catch {
    return defaultPrefs();
  }
};

const savePrefs = (prefs) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* quota / private mode */ }
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const toIso = (d) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const valueFor = (p, key, teamNameById) => {
  switch (key) {
    case 'name': return p.name || '';
    case 'lastName': return p.lastName || '';
    case 'email': return p.email || '';
    case 'role': return p.role || '';
    case 'team': return p.teamId ? (teamNameById.get(String(p.teamId)) || '') : '';
    case 'subteam': return p.subteam || '';
    case 'arrivalDate': return p.arrivalDate ? toIso(p.arrivalDate).slice(0, 10) : '';
    case 'aliases': return Array.isArray(p.aliases) ? p.aliases.join(', ') : '';
    case 'notes': return p.notes || '';
    case 'left': return !!p.left;
    case 'contactOnly': return !!p.contactOnly;
    case 'createdAt': return toIso(p.createdAt);
    case 'updatedAt': return toIso(p.updatedAt);
    default: return '';
  }
};

const buildRows = (people, teams, { includeLeft, includeContacts, selectedFields }) => {
  const teamNameById = new Map((teams || []).map(t => [String(t._id), t.name || '']));
  const filtered = (people || []).filter(p => {
    if (!includeLeft && p.left) return false;
    if (!includeContacts && p.contactOnly) return false;
    return true;
  });
  return filtered.map(p => {
    const row = {};
    selectedFields.forEach(key => {
      row[key] = valueFor(p, key, teamNameById);
    });
    return row;
  });
};

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const exportCsv = (rows, selectedFields) => {
  const headerMap = Object.fromEntries(FIELDS.map(f => [f.key, f.label]));
  const header = selectedFields.map(k => headerMap[k] || k);
  const body = rows.map(r => selectedFields.map(k => csvCell(r[k])).join(','));
  // UTF-8 BOM so Excel opens accents correctly
  const text = '﻿' + [header.join(','), ...body].join('\r\n');
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(new Blob([text], { type: 'text/csv;charset=utf-8' }), `panorama-people-${date}.csv`);
};

const exportJson = (rows) => {
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(
    new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }),
    `panorama-people-${date}.json`
  );
};

export const PeopleExportModal = ({ open, onClose, people, teams }) => {
  const [prefs, setPrefs] = useState(() => defaultPrefs());

  // Load persisted prefs once when modal opens (avoids hydration mismatch on mount)
  useEffect(() => {
    if (open) setPrefs(loadPrefs());
  }, [open]);

  const selectedFields = useMemo(
    () => FIELDS.filter(f => prefs.fields[f.key]).map(f => f.key),
    [prefs.fields]
  );

  const preview = useMemo(() => {
    if (!open) return { total: 0, kept: 0 };
    const total = (people || []).length;
    const kept = (people || []).filter(p => {
      if (!prefs.includeLeft && p.left) return false;
      if (!prefs.includeContacts && p.contactOnly) return false;
      return true;
    }).length;
    return { total, kept };
  }, [open, people, prefs.includeLeft, prefs.includeContacts]);

  const setField = (key, on) => setPrefs(prev => ({ ...prev, fields: { ...prev.fields, [key]: on } }));
  const selectAllFields = () => setPrefs(prev => ({ ...prev, fields: Object.fromEntries(FIELDS.map(f => [f.key, true])) }));
  const selectDefaultFields = () => setPrefs(prev => ({ ...prev, fields: Object.fromEntries(FIELDS.map(f => [f.key, f.defaultOn])) }));
  const clearAllFields = () => setPrefs(prev => ({ ...prev, fields: Object.fromEntries(FIELDS.map(f => [f.key, false])) }));

  const handleExport = () => {
    if (selectedFields.length === 0) {
      notify({ message: 'Select at least one field', kind: 'warning' });
      return;
    }
    const rows = buildRows(people, teams, {
      includeLeft: prefs.includeLeft,
      includeContacts: prefs.includeContacts,
      selectedFields
    });
    if (rows.length === 0) {
      notify({ message: 'No people match the current filters', kind: 'warning' });
      return;
    }
    savePrefs(prefs);
    if (prefs.format === 'csv') exportCsv(rows, selectedFields);
    else exportJson(rows);
    notify({ message: `Exported ${rows.length} ${rows.length === 1 ? 'person' : 'people'}`, kind: 'success' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export People"
      actions={[
        <button key="cancel" className="btn" onClick={onClose}>Cancel</button>,
        <button key="export" className="btn btn-primary ml8" onClick={handleExport}>
          Download {prefs.format.toUpperCase()}
        </button>
      ]}
    >
      <div className="exportModal">
        <section className="exportSection">
          <h4 className="exportSectionTitle">Format</h4>
          <label className="exportInline">
            <input
              type="radio"
              name="exportFormat"
              checked={prefs.format === 'csv'}
              onChange={() => setPrefs(p => ({ ...p, format: 'csv' }))}
            />{' '}CSV
          </label>
          <label className="exportInline ml16">
            <input
              type="radio"
              name="exportFormat"
              checked={prefs.format === 'json'}
              onChange={() => setPrefs(p => ({ ...p, format: 'json' }))}
            />{' '}JSON
          </label>
        </section>

        <section className="exportSection">
          <h4 className="exportSectionTitle">Filters</h4>
          <label className="exportInline">
            <input
              type="checkbox"
              checked={prefs.includeLeft}
              onChange={(e) => setPrefs(p => ({ ...p, includeLeft: e.target.checked }))}
            />{' '}Include people who left
          </label>
          <label className="exportInline ml16">
            <input
              type="checkbox"
              checked={prefs.includeContacts}
              onChange={(e) => setPrefs(p => ({ ...p, includeContacts: e.target.checked }))}
            />{' '}Include external contacts
          </label>
          <div className="exportPreview">
            {preview.kept} / {preview.total} people will be exported
          </div>
        </section>

        <section className="exportSection">
          <div className="exportSectionHeader">
            <h4 className="exportSectionTitle">Fields</h4>
            <div className="exportFieldActions">
              <button type="button" className="btn btn-sm" onClick={selectDefaultFields}>Defaults</button>
              <button type="button" className="btn btn-sm ml8" onClick={selectAllFields}>All</button>
              <button type="button" className="btn btn-sm ml8" onClick={clearAllFields}>None</button>
            </div>
          </div>
          <div className="exportFieldsGrid">
            {FIELDS.map(f => (
              <label key={f.key} className="exportField">
                <input
                  type="checkbox"
                  checked={!!prefs.fields[f.key]}
                  onChange={(e) => setField(f.key, e.target.checked)}
                />{' '}{f.label}
              </label>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
};

PeopleExportModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  people: PropTypes.array,
  teams: PropTypes.array
};
