import React, { useMemo, useState } from 'react';
import './BudgetPage.css';
import * as XLSX from 'xlsx';
//
import { Meteor } from 'meteor/meteor';
//
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { parseHashRoute } from '/imports/ui/router.js';
import { parseWorkbook } from '/imports/ui/Budget/import/parseWorkbook.js';
import { ReportTab } from '/imports/ui/Budget/tabs/ReportTab/ReportTab.jsx';
import { VendorsMonthlyTab } from '/imports/ui/Budget/tabs/VendorsMonthlyTab/VendorsMonthlyTab.jsx';
import { VendorsTotalsTab } from '/imports/ui/Budget/tabs/VendorsTotalsTab/VendorsTotalsTab.jsx';
import { RecentLinesTab } from '/imports/ui/Budget/tabs/RecentLinesTab/RecentLinesTab.jsx';
import { CheckTab } from '/imports/ui/Budget/tabs/CheckTab/CheckTab.jsx';
import { TeamsTab } from '/imports/ui/Budget/tabs/TeamsTab/TeamsTab.jsx';
import { ImportTab } from '/imports/ui/Budget/tabs/ImportTab/ImportTab.jsx';
import { ImportSettings } from '/imports/ui/Budget/tabs/ImportSettings/ImportSettings.jsx';
import { filterByQuery, applyDepartmentFilter, applyTeamFilter, filterByDateRange, applyCurrencyFilter } from '/imports/ui/Budget/utils/filters.js';
import { useBudgetData } from '/imports/ui/Budget/hooks/useBudgetData.js';
import { notify, setNotifyHandler } from '/imports/ui/utils/notify.js';

const safe = (v) => (v === undefined || v === null ? '' : v);

export const BudgetPage = () => {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  
  // Legacy setToast still passed to child tabs; children will call it and we bridge to global notify in effect
  const [toast, setToast] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);

  // subscription handled in useBudgetData
  const [activeTab, setActiveTab] = useState(() => {
    const r = parseHashRoute();
    return r && r.name === 'budget' && r.tab ? r.tab : 'report';
  });
  React.useEffect(() => {
    const onHash = () => {
      const r = parseHashRoute();
      setActiveTab(r && r.name === 'budget' && r.tab ? r.tab : 'report');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  React.useEffect(() => {
    setNotifyHandler((t) => setToast(t));
    return () => setNotifyHandler(null);
  }, []);
  React.useEffect(() => {
    if (!toast) return;
    notify(toast);
    // Clear local toast after forwarding so components keep working without stacking locally
    const t = setTimeout(() => setToast(null), 0);
    return () => clearTimeout(t);
  }, [toast?.message, toast?.kind]);
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [vendorsDept, setVendorsDept] = useState('all');
  const [reportDept, setReportDept] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [vendorsSort, setVendorsSort] = useState('name'); // name | amount-desc | amount-asc
  const [vendorsDateRange, setVendorsDateRange] = useState('all'); // all | thisMonth | lastMonth | last7 | last30
  const [searchReport, setSearchReport] = useState('');
  const [searchVendors, setSearchVendors] = useState('');
  const [searchRecent, setSearchRecent] = useState('');
  const [vendorsMonthlyDateRange, setVendorsMonthlyDateRange] = useState('all');
  const [searchCheck, setSearchCheck] = useState('');
  const [teamsDateRange, setTeamsDateRange] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');

  const { allLines } = useBudgetData(departmentFilter);

  

  const totalPreview = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.amountTtc) || 0), 0), [rows]);

  // Page-first filtering (Option A): compute filtered rows for each tab
  const rowsReport = useMemo(() => {
    let r = applyDepartmentFilter(allLines, reportDept);
    r = applyTeamFilter(r, teamFilter);
    r = filterByQuery(r, searchReport);
    return r;
  }, [allLines, reportDept, teamFilter, searchReport]);

  const rowsVendorsMonthly = useMemo(() => {
    let r = applyDepartmentFilter(allLines, vendorsDept);
    r = applyTeamFilter(r, teamFilter);
    r = filterByQuery(r, searchVendors);
    r = filterByDateRange(r, vendorsMonthlyDateRange);
    return r;
  }, [allLines, vendorsDept, teamFilter, searchVendors, vendorsMonthlyDateRange]);

  const rowsVendorsTotals = useMemo(() => {
    const toIso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    let from = '';
    let to = '';
    if (vendorsDateRange === 'thisMonth') {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      from = toIso(start);
      to = toIso(today);
    } else if (vendorsDateRange === 'lastMonth') {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      from = toIso(start);
      to = toIso(end);
    } else if (vendorsDateRange === 'last7') {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 6);
      from = toIso(start);
      to = toIso(today);
    } else if (vendorsDateRange === 'last30') {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 29);
      from = toIso(start);
      to = toIso(today);
    }
    if (!from && !to) return rowsVendorsMonthly;
    return rowsVendorsMonthly.filter((r) => {
      const ds = String(r.date || '');
      if (!ds) return false;
      if (from && ds < from) return false;
      if (to && ds > to) return false;
      return true;
    });
  }, [rowsVendorsMonthly, vendorsDateRange]);

  const rowsRecent = useMemo(() => {
    let r = applyDepartmentFilter(allLines, departmentFilter);
    r = applyTeamFilter(r, teamFilter);
    r = applyCurrencyFilter(r, currencyFilter);
    r = filterByQuery(r, searchRecent);
    // Ensure most recent first by date desc (string ISO or date)
    return r.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (Number(b.importedAt || 0) - Number(a.importedAt || 0)));
  }, [allLines, departmentFilter, teamFilter, currencyFilter, searchRecent]);

  

  const onChooseFile = async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    const merged = [];
    
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const preview = parseWorkbook(wb);
      merged.push(...preview);
    }
    setRows(merged);
    setFileName(files.length === 1 ? files[0].name : `${files.length} files`);
  };

  const onConfirmImport = () => {
    if (rows.length === 0) return;
    setImporting(true);
    const lines = rows.map(r => ({
      date: r.date,
      vendor: r.vendor,
      category: r.category,
      autoCategory: r.autoCategory,
      amountTtc: r.amountTtc,
      vat: r.vat,
      currency: r.currency,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      analyticsCategory: r.analyticsCategory,
      analyticsWeight: r.analyticsWeight,
      sourceRef: r.sourceRef,
      notes: r.notes
    }));
    Meteor.call('budget.importLines', { importFile: (fileName && !String(fileName).endsWith('files')) ? fileName : 'multi-upload', lines }, (err, res) => {
      setImporting(false);
      if (err) {
        console.error('budget.importLines failed', err);
        setMessage('Import failed');
        return;
      }
      const extras = [];
      if (res?.skipped) extras.push(`skipped ${res.skipped}`);
      if (typeof res?.unknownDates === 'number') extras.push(`unknownDates ${res.unknownDates}`);
      const message = `Imported ${res?.imported || 0} lines${extras.length ? `, ${extras.join(', ')}` : ''}`;
      setMessage(message);
      
      setRows([]);
      setFileName('');
    });
  };

  

  return (
    <div className="budgetPage">
      <h2>Budget</h2>
      <div className="budgetTabs">
        <a href="#/budget/report" className={activeTab === 'report' ? 'active' : ''}>Report monthly total</a>
        <a href="#/budget/vendors" className={activeTab === 'vendors' ? 'active' : ''}>Monthly by vendor</a>
        <a href="#/budget/vendors-total" className={activeTab === 'vendors-total' ? 'active' : ''}>Vendor totals</a>
        <a href="#/budget/teams" className={activeTab === 'teams' ? 'active' : ''}>Teams</a>
        <a href="#/budget/recent" className={activeTab === 'recent' ? 'active' : ''}>Recent lines</a>
        <a href="#/budget/import" className={activeTab === 'import' ? 'active' : ''}>Import</a>
        <a href="#/budget/settings" className={activeTab === 'settings' ? 'active' : ''}>Settings</a>
        <a href="#/budget/check" className={activeTab === 'check' ? 'active' : ''}>Check</a>
      </div>
      <div>
        {activeTab === 'report' && (
          <ReportTab
            rows={rowsReport}
            filter={reportDept}
            teamFilter={teamFilter}
            search={searchReport}
            onFilterChange={setReportDept}
            onTeamChange={setTeamFilter}
            onSearchChange={setSearchReport}
            setToast={setToast}
          />
        )}
        {activeTab === 'vendors' && (
          <VendorsMonthlyTab
            rows={rowsVendorsMonthly}
            filter={vendorsDept}
            teamFilter={teamFilter}
            search={searchVendors}
            onFilterChange={setVendorsDept}
            onTeamChange={setTeamFilter}
            onSearchChange={setSearchVendors}
            dateRange={vendorsMonthlyDateRange}
            onDateRangeChange={setVendorsMonthlyDateRange}
            setToast={setToast}
          />
        )}
        {activeTab === 'vendors-total' && (
          <VendorsTotalsTab
            rows={rowsVendorsTotals}
            filter={vendorsDept}
            teamFilter={teamFilter}
            sort={vendorsSort}
            dateRange={vendorsDateRange}
            search={searchVendors}
            onFilterChange={setVendorsDept}
            onTeamChange={setTeamFilter}
            onSortChange={setVendorsSort}
            onSearchChange={setSearchVendors}
            onDateRangeChange={setVendorsDateRange}
            setToast={setToast}
          />
        )}
        {activeTab === 'import' && (
          <div className="panel">
            <div className="sectionActions">
              <button className="btn danger" onClick={() => setResetOpen(true)}>Reset all</button>
            </div>
            <ImportTab
              fileName={fileName}
              rows={rows}
              importing={importing}
              totalPreview={totalPreview}
              onChooseFile={onChooseFile}
              onConfirmImport={onConfirmImport}
            />
            {message ? <p>{message}</p> : null}
          </div>
        )}
        {activeTab === 'settings' && (
          <ImportSettings />
        )}
        {activeTab === 'check' && (
          <CheckTab
            rows={rowsReport}
            filter={reportDept}
            teamFilter={teamFilter}
            search={searchCheck}
            onFilterChange={setReportDept}
            onTeamChange={setTeamFilter}
            onSearchChange={setSearchCheck}
            setToast={setToast}
          />
        )}
        {activeTab === 'teams' && (
          <TeamsTab
            rows={allLines}
            filter={reportDept}
            teamFilter={teamFilter}
            search={searchReport}
            dateRange={teamsDateRange}
            onFilterChange={setReportDept}
            onTeamChange={setTeamFilter}
            onDateRangeChange={setTeamsDateRange}
            onSearchChange={setSearchReport}
            setToast={setToast}
          />
        )}
        {activeTab === 'recent' && (
          <RecentLinesTab
            rows={rowsRecent}
            search={searchRecent}
            onSearchChange={setSearchRecent}
            departmentFilter={departmentFilter}
            onDeptChange={setDepartmentFilter}
            teamFilter={teamFilter}
            onTeamChange={setTeamFilter}
            currencyFilter={currencyFilter}
            onCurrencyChange={setCurrencyFilter}
            setToast={setToast}
          />
        )}
      </div>
      
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset all budget lines"
        actions={[
          <button key="cancel" className="btn" onClick={() => setResetOpen(false)}>Cancel</button>,
          <button
            key="confirm"
            className="btn danger"
            onClick={() => {
              Meteor.call('budget.resetAll', (err, res) => {
                if (err) { console.error('budget.resetAll failed', err); notify({ message: 'Reset failed', kind: 'error' }); return; }
                notify({ message: `Deleted ${res?.deleted || 0} lines`, kind: 'success' });
                setResetOpen(false);
              });
            }}
          >
            Delete all
          </button>
        ]}
      >
        This action will permanently delete all budget lines. This cannot be undone.
      </Modal>
    </div>
  );
};

export default BudgetPage;


