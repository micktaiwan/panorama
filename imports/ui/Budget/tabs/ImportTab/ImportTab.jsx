import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { notify } from '/imports/ui/utils/notify.js';
import { Tooltip } from '/imports/ui/components/Tooltip/Tooltip.jsx';
import { VendorsIgnoreCollection } from '/imports/api/budget/collections';
import './ImportTab.css';

export const ImportTab = ({ fileName, rows, importing, totalPreview, onChooseFile, onConfirmImport }) => {
  // Subscribe to vendorsIgnore collection
  const vendorsIgnoreSubscription = useTracker(() => {
    return Meteor.subscribe('budget.vendorsIgnore');
  }, []);

  const vendorsIgnoreData = useTracker(() => {
    const data = VendorsIgnoreCollection.find({}).fetch();
    console.log('VendorsIgnore subscription data updated:', data);
    return data;
  }, [vendorsIgnoreSubscription]);

  const guessVendorFromLabel = (label, filename, extra) => {
    const base = String(label || extra || filename || '').trim();
    if (!base) return '';
    let s = base;
    s = s.replace(/\(label généré\)/ig, '');
    s = s.replace(/\([^)]*\)\s*$/g, '');
    s = s.replace(/^Facture\s+/i, '').trim();
    const parts = s.split(/\s*[\-–—]\s*/).filter(Boolean);
    if (parts.length > 0) return parts[0].trim();
    return s.trim();
  };
  const isImageFilename = (name) => /\.(png|jpe?g|gif|webp|heic)$/i.test(String(name || ''));
  const isPdfPublicUrl = (url) => String(url || '').toLowerCase().includes('/public/invoice/pdf');
  const [apiRows, setApiRows] = React.useState(() => {
    const raw = localStorage.getItem('budget.apiCache');
    return raw ? JSON.parse(raw) : [];
  });
  const [fetching, setFetching] = React.useState(false);
  const [apiCursor, setApiCursor] = React.useState('');
  const [apiSearchVendor, setApiSearchVendor] = React.useState(() => {
    return localStorage.getItem('budget.apiSearchVendor') || '';
  });
  React.useEffect(() => {
    localStorage.setItem('budget.apiSearchVendor', String(apiSearchVendor || ''));
  }, [apiSearchVendor]);
  const apiRowsFiltered = React.useMemo(() => {
    const q = String(apiSearchVendor || '').toLowerCase().trim();
    if (!q) return apiRows;
    return apiRows.filter(r => String(r.vendor || '').toLowerCase().includes(q));
  }, [apiRows, apiSearchVendor]);
  const apiTotal = React.useMemo(() => apiRowsFiltered.reduce((acc, r) => acc + (Number(r.amountTtc) || 0), 0), [apiRowsFiltered]);
  const [dupMap, setDupMap] = React.useState({});
  const [importMap, setImportMap] = React.useState({});
  const [ignored, setIgnored] = React.useState({ count: 0, examples: [] });
  const [hideDuplicates, setHideDuplicates] = React.useState(() => {
    const raw = localStorage.getItem('budget.apiHideDup');
    return raw ? raw === '1' : false;
  });
  React.useEffect(() => {
    localStorage.setItem('budget.apiHideDup', hideDuplicates ? '1' : '0');
  }, [hideDuplicates]);
  const [hidePhotos, setHidePhotos] = React.useState(() => {
    const raw = localStorage.getItem('budget.apiHidePhoto');
    return raw ? raw === '1' : false;
  });
  React.useEffect(() => {
    localStorage.setItem('budget.apiHidePhoto', hidePhotos ? '1' : '0');
  }, [hidePhotos]);
  const rowKey = (r) => `${r.invoiceId}|${r.invoiceNumber}|${r.date}|${r.vendor}|${r.amountTtc}|${r.currency}`.slice(0, 240);

  // Helper function to filter ignored items (same logic as server)
  const filterIgnoredItems = (rows, ignoreList) => {
    // Use vendorsIgnoreData from subscription if available, otherwise fallback to ignoreList
    const list = vendorsIgnoreData && vendorsIgnoreData.length > 0 
      ? vendorsIgnoreData 
      : (Array.isArray(ignoreList && ignoreList.items) ? ignoreList.items : []);
    
    // Create sets for different types of ignore rules
    const supplierIdSet = new Set();
    const vendorNameSet = new Set();
    const urlSet = new Set();
    
    // Populate sets based on ignore list items
    for (const item of list) {
      if (item.type === 'supplier' && item.supplierId) {
        supplierIdSet.add(String(item.supplierId));
      } else if (item.type === 'label' && item.vendorNameLower) {
        vendorNameSet.add(String(item.vendorNameLower));
      } else if (item.type === 'photo/pdf' && item.publicFileUrl) {
        urlSet.add(String(item.publicFileUrl));
      } else if (!item.type) {
        // Backward compatibility: if no type specified, infer from presence of fields
        if (item.supplierId) {
          supplierIdSet.add(String(item.supplierId));
        } else if (item.vendorNameLower) {
          vendorNameSet.add(String(item.vendorNameLower));
        }
      }
    }
    
    return rows.filter(r => {
      // Check supplier ID match
      if (r.supplierId && supplierIdSet.has(String(r.supplierId))) {
        return false;
      }
      
      // Check vendor name match
      const nameLower = String(r.vendor || '').trim().toLowerCase();
      if (nameLower && vendorNameSet.has(nameLower)) {
        return false;
      }
      
      // Check URL match
      if (r.publicFileUrl && urlSet.has(String(r.publicFileUrl))) {
        return false;
      }
      
      return true;
    });
  };

  const apiRange = React.useMemo(() => {
    if (!Array.isArray(apiRows) || apiRows.length === 0) return null;
    const onlyDates = apiRows.map(r => String((r.apiDate || r.apiDeadline || '') || '').slice(0,10)).filter(Boolean);
    if (onlyDates.length === 0) return null;
    const minDate = onlyDates.reduce((m, d) => (d < m ? d : m), onlyDates[0]);
    const maxDate = onlyDates.reduce((m, d) => (d > m ? d : m), onlyDates[0]);
    return { min: minDate, max: maxDate };
  }, [apiRows]);

  React.useEffect(() => {
    const rowsToCheck = apiRowsFiltered.slice(0, 100);
    let cancelled = false;
    const run = async () => {
      await Promise.all(rowsToCheck.map((r) => new Promise((resolve) => {
        const key = rowKey(r);
        if (dupMap[key]) { resolve(); return; }
        Meteor.call('budget.checkDuplicate', r, (e2, res) => {
          if (cancelled) { resolve(); return; }
          if (e2) { console.error('checkDuplicate failed', e2); setDupMap(prev => ({ ...prev, [key]: { error: true } })); resolve(); return; }
          setDupMap(prev => ({ ...prev, [key]: res || { exists: false } }));
          resolve();
        });
      })));
    };
    run();
    return () => { cancelled = true; };
  }, [apiRowsFiltered]);

  const [apiDateFrom, setApiDateFrom] = React.useState(() => {
    return localStorage.getItem('budget.apiDateFrom') || '';
  });
  const [apiDateTo, setApiDateTo] = React.useState(() => {
    return localStorage.getItem('budget.apiDateTo') || '';
  });
  React.useEffect(() => {
    localStorage.setItem('budget.apiDateFrom', String(apiDateFrom || ''));
  }, [apiDateFrom]);
  React.useEffect(() => {
    localStorage.setItem('budget.apiDateTo', String(apiDateTo || ''));
  }, [apiDateTo]);

  const apiRowsVisible = React.useMemo(() => {
    let rows = apiRowsFiltered;
    if (hideDuplicates) {
      rows = rows.filter((r) => {
        const d = dupMap[rowKey(r)];
        return !(d && d.exists);
      });
    }
    if (hidePhotos) {
      rows = rows.filter((r) => String(r.vendor || '').toLowerCase() !== 'photo/pdf');
    }
    return rows;
  }, [apiRowsFiltered, hideDuplicates, hidePhotos, dupMap]);

  const [apiLimit, setApiLimit] = React.useState(() => {
    const raw = localStorage.getItem('budget.apiLimit');
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 100;
  });
  React.useEffect(() => {
    localStorage.setItem('budget.apiLimit', String(apiLimit));
  }, [apiLimit]);

  const fetchFromApi = () => {
    setFetching(true);
    const filters = {};
    if (apiDateFrom) filters.date_from = apiDateFrom;
    if (apiDateTo) filters.date_to = apiDateTo;
    Meteor.call('budget.fetchPennylaneSupplierInvoices', null, apiLimit, filters, (err, body) => {
      setFetching(false);
      if (err) { console.error('budget.fetchPennylaneSupplierInvoices failed', err); notify({ message: `API fetch failed: ${err.reason || err.message || 'error'}`, kind: 'error' }); return; }
      const items = (body && body.items) || [];
      setApiCursor((body && body.next_cursor) || '');
      const supplierIds = Array.from(new Set(items.map(it => it?.supplier?.id).filter(Boolean))).map(String);
      const afterVendors = (vendorsMap) => {
        const mapped = items.map((it) => {
          const dateNorm = (it.created_at ? String(it.created_at).slice(0,10) : '') || it.date || it.deadline || '';
          const supplierIdStr = (it.supplier && it.supplier.id) ? String(it.supplier.id) : undefined;
          let vendorName = '';
          if (supplierIdStr) {
            vendorName = vendorsMap[String(it.supplier.id)] || `supplier#${it.supplier.id}`;
          } else {
            const autoLabel = String(it.label || '').toLowerCase().includes('label généré');
            const looksImage = isImageFilename(it && it.filename);
            if (autoLabel || looksImage) vendorName = 'Photo/PDF';
            if (!vendorName) vendorName = guessVendorFromLabel(it.label, it.filename, it.external_reference) || '';
          }
          return ({
            date: dateNorm,
            vendor: vendorName,
            supplierId: supplierIdStr,
            category: undefined,
            autoCategory: undefined,
            amountTtc: Number((it.currency_amount ?? it.amount) || 0),
            vat: Number((it.currency_tax ?? it.tax ?? 0) || 0),
            currency: String(it.currency || 'EUR'),
            invoiceId: String(it.id || ''),
            invoiceNumber: String(it.invoice_number || ''),
            sourceRef: String(it.external_reference || it.filename || ''),
            paymentStatus: String(it.payment_status || ((Number(it.remaining_amount_with_tax) === 0) ? 'paid' : '') || ''),
            paymentDate: it.deadline || undefined,
            publicFileUrl: it && it.public_file_url ? String(it.public_file_url) : undefined,
            apiDate: String(it.date || ''),
            apiDeadline: String(it.deadline || ''),
          });
        });
        // Debugs omitted for brevity
        // Rely on API sorting; do not sort locally
        // Apply ignore rules client-side
        // Use subscription data if available, otherwise fallback to method call
        if (vendorsIgnoreData && vendorsIgnoreData.length >= 0) {
          console.log('Using subscription data for filtering:', vendorsIgnoreData);
          console.log('Items to filter:', mapped.length);
          
          const filtered = filterIgnoredItems(mapped, { items: vendorsIgnoreData });
          const removed = mapped.length - filtered.length;
          
          console.log('After filtering:', filtered.length, 'removed:', removed);
          
          // Calculate examples
          const exampleNames = [];
          const seenExamples = new Set();
          for (const r of mapped) {
            const isIgnored = !filtered.includes(r);
            if (!isIgnored) continue;
            const nm = String(r.vendor || (r.supplierId ? `supplier#${r.supplierId}` : ''));
            const key = `${r.supplierId || ''}|${nm.trim().toLowerCase()}`;
            if (seenExamples.has(key)) continue;
            seenExamples.add(key);
            exampleNames.push(nm);
            if (exampleNames.length >= 5) break;
          }
          
          setIgnored({ count: removed, examples: exampleNames });
          localStorage.setItem('budget.apiCache', JSON.stringify(filtered));
          setApiRows(filtered);
        } else {
          // Fallback to method call if subscription data not available
          Meteor.call('budget.fetchVendorsIgnore', (errIg, resIg) => {
            if (errIg) { 
              console.error('fetchVendorsIgnore failed', errIg); 
              notify({ message: `Failed to load ignore rules: ${errIg.reason || errIg.message || 'Unknown error'}`, kind: 'error' });
              setIgnored({ count: 0, examples: [] }); 
              return; 
            }
            
            console.log('VendorsIgnore data received:', resIg);
            console.log('Items to filter:', mapped.length);
            
            const filtered = filterIgnoredItems(mapped, resIg);
            const removed = mapped.length - filtered.length;
            
            console.log('After filtering:', filtered.length, 'removed:', removed);
            
            // Calculate examples
            const exampleNames = [];
            const seenExamples = new Set();
            for (const r of mapped) {
              const isIgnored = !filtered.includes(r);
              if (!isIgnored) continue;
              const nm = String(r.vendor || (r.supplierId ? `supplier#${r.supplierId}` : ''));
              const key = `${r.supplierId || ''}|${nm.trim().toLowerCase()}`;
              if (seenExamples.has(key)) continue;
              seenExamples.add(key);
              exampleNames.push(nm);
              if (exampleNames.length >= 5) break;
            }
            
            setIgnored({ count: removed, examples: exampleNames });
            localStorage.setItem('budget.apiCache', JSON.stringify(filtered));
            setApiRows(filtered);
          });
        }
        notify({ message: `Fetched ${mapped.length} invoices from API`, kind: 'success' });
      };
      if (supplierIds.length > 0) {
        Meteor.call('budget.ensureVendors', supplierIds, (e2, vendorsMap) => {
          if (e2) { console.error('ensureVendors failed', e2); afterVendors({}); return; }
          afterVendors(vendorsMap || {});
        });
      } else {
        afterVendors({});
      }
    });
  };
  const loadMoreFromApi = () => {
    if (!apiCursor) return;
    setFetching(true);
    const filters = {};
    if (apiDateFrom) filters.date_from = apiDateFrom;
    if (apiDateTo) filters.date_to = apiDateTo;
    Meteor.call('budget.fetchPennylaneSupplierInvoices', apiCursor, apiLimit, filters, (err, body) => {
      setFetching(false);
      if (err) { console.error('budget.fetchPennylaneSupplierInvoices failed', err); notify({ message: `API fetch failed: ${err.reason || err.message || 'error'}`, kind: 'error' }); return; }
      const items = (body && body.items) || [];
      setApiCursor((body && body.next_cursor) || '');
      const supplierIds = Array.from(new Set(items.map(it => it?.supplier?.id).filter(Boolean))).map(String);
      const afterVendors = (vendorsMap) => {
        const mapped = items.map((it) => {
          const supplierIdStr = (it.supplier && it.supplier.id) ? String(it.supplier.id) : undefined;
          let vendorName = '';
          if (supplierIdStr) {
            vendorName = vendorsMap[String(it.supplier.id)] || `supplier#${it.supplier.id}`;
          } else {
            const autoLabel = String(it.label || '').toLowerCase().includes('label généré');
            const looksImage = isImageFilename(it && it.filename);
            if (autoLabel || looksImage) vendorName = 'Photo/PDF';
            if (!vendorName) vendorName = guessVendorFromLabel(it.label, it.filename, it.external_reference) || '';
          }
          return ({
            date: (it.created_at ? String(it.created_at).slice(0,10) : '') || it.date || it.deadline || '',
            vendor: vendorName,
            supplierId: supplierIdStr,
            category: undefined,
            autoCategory: undefined,
            amountTtc: Number((it.currency_amount ?? it.amount) || 0),
            vat: Number((it.currency_tax ?? it.tax ?? 0) || 0),
            currency: String(it.currency || 'EUR'),
            invoiceId: String(it.id || ''),
            invoiceNumber: String(it.invoice_number || ''),
            sourceRef: String(it.external_reference || it.filename || ''),
            paymentStatus: String(it.payment_status || ((Number(it.remaining_amount_with_tax) === 0) ? 'paid' : '') || ''),
            publicFileUrl: it && it.public_file_url ? String(it.public_file_url) : undefined,
            apiDate: String(it.date || ''),
            apiDeadline: String(it.deadline || ''),
          });
        });
        // Apply ignore rules on the newly fetched page, then merge
        // Use subscription data if available, otherwise fallback to method call
        if (vendorsIgnoreData && vendorsIgnoreData.length >= 0) {
          console.log('Using subscription data for loadMore filtering:', vendorsIgnoreData);
          
          const filteredNew = filterIgnoredItems(mapped, { items: vendorsIgnoreData });
          const removedDelta = mapped.length - filteredNew.length;
          
          // Calculate examples
          const exampleNames = [];
          const seenExamples = new Set();
          for (const r of mapped) {
            const isIgnored = !filteredNew.includes(r);
            if (!isIgnored) continue;
            const nm = String(r.vendor || (r.supplierId ? `supplier#${r.supplierId}` : ''));
            const key = `${r.supplierId || ''}|${nm.trim().toLowerCase()}`;
            if (seenExamples.has(key)) continue;
            seenExamples.add(key);
            exampleNames.push(nm);
            if (exampleNames.length >= 5) break;
          }
          
          setIgnored(prev => {
            const prevSeen = new Set((prev.examples || []).map(x => String(x).trim().toLowerCase()));
            const mergedExamples = [...prev.examples];
            for (const nm of exampleNames) {
              const k = String(nm).trim().toLowerCase();
              if (!prevSeen.has(k)) { mergedExamples.push(nm); prevSeen.add(k); }
              if (mergedExamples.length >= 5) break;
            }
            return { count: (prev.count || 0) + removedDelta, examples: mergedExamples.slice(0, 5) };
          });
          
          // Merge without local sorting; rely on API order
          const nextAll = [...apiRows, ...filteredNew];
          localStorage.setItem('budget.apiCache', JSON.stringify(nextAll));
          setApiRows(nextAll);
          notify({ message: `Loaded ${mapped.length} more invoices`, kind: 'success' });
        } else {
          // Fallback to method call if subscription data not available
          Meteor.call('budget.fetchVendorsIgnore', (errIg, resIg) => {
            if (errIg) { 
              console.error('fetchVendorsIgnore failed', errIg); 
              notify({ message: `Failed to load ignore rules: ${errIg.reason || errIg.message || 'Unknown error'}`, kind: 'error' });
              return; 
            }
            
            const filteredNew = filterIgnoredItems(mapped, resIg);
            const removedDelta = mapped.length - filteredNew.length;
            
            // Calculate examples
            const exampleNames = [];
            const seenExamples = new Set();
            for (const r of mapped) {
              const isIgnored = !filteredNew.includes(r);
              if (!isIgnored) continue;
              const nm = String(r.vendor || (r.supplierId ? `supplier#${r.supplierId}` : ''));
              const key = `${r.supplierId || ''}|${nm.trim().toLowerCase()}`;
              if (seenExamples.has(key)) continue;
              seenExamples.add(key);
              exampleNames.push(nm);
              if (exampleNames.length >= 5) break;
            }
            
            setIgnored(prev => {
              const prevSeen = new Set((prev.examples || []).map(x => String(x).trim().toLowerCase()));
              const mergedExamples = [...prev.examples];
              for (const nm of exampleNames) {
                const k = String(nm).trim().toLowerCase();
                if (!prevSeen.has(k)) { mergedExamples.push(nm); prevSeen.add(k); }
                if (mergedExamples.length >= 5) break;
              }
              return { count: (prev.count || 0) + removedDelta, examples: mergedExamples.slice(0, 5) };
            });
            
            // Merge without local sorting; rely on API order
            const nextAll = [...apiRows, ...filteredNew];
            localStorage.setItem('budget.apiCache', JSON.stringify(nextAll));
            setApiRows(nextAll);
            notify({ message: `Loaded ${mapped.length} more invoices`, kind: 'success' });
          });
        }
      };
      if (supplierIds.length > 0) {
        Meteor.call('budget.ensureVendors', supplierIds, (e2, vendorsMap) => {
          if (e2) { console.error('ensureVendors failed', e2); afterVendors({}); return; }
          afterVendors(vendorsMap || {});
        });
      } else {
        afterVendors({});
      }
    });
  };
  const importFromApiCache = () => {
    if (!apiRows || apiRows.length === 0) { notify({ message: 'No API cache to import', kind: 'error' }); return; }
    Meteor.call('budget.importLines', { importFile: 'pennylane-api', lines: apiRows }, (err, res) => {
      if (err) { console.error('budget.importLines failed', err); notify({ message: 'Import failed', kind: 'error' }); return; }
      notify({ message: `Imported ${res?.imported || 0} lines`, kind: 'success' });
      // Mark all visible API rows as duplicate locally so they can hide if toggle is enabled
      setDupMap((prev) => {
        const next = { ...prev };
        for (const r of apiRows) {
          const k = rowKey(r);
          next[k] = { exists: true, matchKind: 'imported' };
        }
        return next;
      });
    });
  };
  return (
    <div className="panel">
      <h3>Import</h3>
      <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onChooseFile} />
      {fileName ? <p>Selected: <strong>{fileName}</strong></p> : null}
      {rows.length > 0 ? (
        <div className="previewTable scrollArea">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Auto category</th>
                <th>Amount TTC</th>
                <th>Currency</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((r, idx) => (
                <tr key={`${r.invoiceId}|${r.invoiceNumber}|${r.date}|${r.vendor}|${idx}`.slice(0, 240)}>
                  <td>{r.date}</td>
                  <td>{r.vendor}</td>
                  <td>{r.autoCategory}</td>
                  <td>{Number(r.amountTtc || 0).toFixed(2)}</td>
                  <td>{r.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 ? <p className="muted">Showing first 100 / {rows.length} rows</p> : null}
          <p><strong>Total preview:</strong> {totalPreview.toFixed(2)} {(rows[0] && rows[0].currency) || 'EUR'}</p>
        </div>
      ) : (
        <p className="muted">Select a Pennylane `.xlsx` export. We will parse three sheets: invoices, invoice lines, and Analytics.</p>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={rows.length === 0 || importing} onClick={onConfirmImport}>
          {importing ? 'Importing…' : 'Confirm import'}
        </button>
        {/* Primary: Last updates */}
        <span className="ml8" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="date"
            value={apiDateFrom}
            onChange={(e) => {
              const t = e && e.target;
              let v = '';
              if (t && t.valueAsDate instanceof Date && !Number.isNaN(t.valueAsDate.getTime())) {
                const d = t.valueAsDate;
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                v = `${yyyy}-${mm}-${dd}`;
              } else {
                const raw = String((t && t.value) || '').trim();
                const mIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                const mFr = raw.match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{4})$/);
                if (mIso) v = mIso[0];
                else if (mFr) {
                  const dd = String(mFr[1]).padStart(2, '0');
                  const mm = String(mFr[2]).padStart(2, '0');
                  const yyyy = String(mFr[3]);
                  v = `${yyyy}-${mm}-${dd}`;
                } else v = raw;
              }
              setApiDateFrom(v);
            }}
            title="From (start_date for last updates)"
          />
          <select className="budgetSelect" value={apiLimit} onChange={(e) => setApiLimit(Number(e.target.value))}>
            <option value={5}>5</option>
            <option value={20}>20</option>
            <option value={100}>100</option>
          </select>
          <button className="btn" onClick={() => {
            setFetching(true);
            Meteor.call('budget.fetchPennylaneLastUpdates', apiDateFrom || '', apiLimit, (err, body) => {
              setFetching(false);
              if (err) { console.error('budget.fetchPennylaneLastUpdates failed', err); notify({ message: `Last updates failed: ${err.reason || err.message || 'error'}`, kind: 'error' }); return; }
              const items = (body && body.items) || [];
              const supplierIds = Array.from(new Set(items.map(it => it?.supplier?.id).filter(Boolean))).map(String);
              const afterVendors = (vendorsMap) => {
                const mapped = items.map((it) => {
                  const supplierIdStr = (it.supplier && it.supplier.id) ? String(it.supplier.id) : undefined;
                  let vendorName = '';
                  if (supplierIdStr) {
                    vendorName = vendorsMap[String(it.supplier.id)] || `supplier#${it.supplier.id}`;
                  } else {
                    const autoLabel = String(it.label || '').toLowerCase().includes('label généré');
                    const looksImage = isImageFilename(it && it.filename);
                    if (autoLabel || looksImage) vendorName = 'Photo/PDF';
                    if (!vendorName) vendorName = guessVendorFromLabel(it.label, it.filename, it.external_reference) || '';
                  }
                  return ({
                    date: (it.created_at ? String(it.created_at).slice(0,10) : '') || it.date || it.deadline || '',
                    vendor: vendorName,
                    supplierId: supplierIdStr,
                    amountTtc: Number((it.currency_amount ?? it.amount) || 0),
                    vat: Number((it.currency_tax ?? it.tax ?? 0) || 0),
                    currency: String(it.currency || 'EUR'),
                    invoiceId: String(it.id || ''),
                    invoiceNumber: String(it.invoice_number || ''),
                    sourceRef: String(it.external_reference || it.filename || ''),
                    paymentStatus: String(it.payment_status || ((Number(it.remaining_amount_with_tax) === 0) ? 'paid' : '') || ''),
                    publicFileUrl: it && it.public_file_url ? String(it.public_file_url) : undefined,
                    apiDate: String(it.date || ''),
                    apiDeadline: String(it.deadline || ''),
                  });
                });
                // Use subscription data if available, otherwise fallback to method call
                if (vendorsIgnoreData && vendorsIgnoreData.length >= 0) {
                  console.log('Using subscription data for last updates filtering:', vendorsIgnoreData);
                  
                  const filtered = filterIgnoredItems(mapped, { items: vendorsIgnoreData });
                  const removed = mapped.length - filtered.length;
                  
                  setIgnored({ count: removed, examples: [] });
                  localStorage.setItem('budget.apiCache', JSON.stringify(filtered));
                  setApiRows(filtered);
                  notify({ message: `Fetched ${filtered.length} last updates`, kind: 'success' });
                } else {
                  // Fallback to method call if subscription data not available
                  Meteor.call('budget.fetchVendorsIgnore', (errIg, resIg) => {
                    if (errIg) { 
                      console.error('fetchVendorsIgnore failed', errIg); 
                      notify({ message: `Failed to load ignore rules: ${errIg.reason || errIg.message || 'Unknown error'}`, kind: 'error' });
                      setIgnored({ count: 0, examples: [] }); 
                      return; 
                    }
                    
                    const filtered = filterIgnoredItems(mapped, resIg);
                    const removed = mapped.length - filtered.length;
                    
                    setIgnored({ count: removed, examples: [] });
                    localStorage.setItem('budget.apiCache', JSON.stringify(filtered));
                    setApiRows(filtered);
                    notify({ message: `Fetched ${filtered.length} last updates`, kind: 'success' });
                  });
                }
              };
              if (supplierIds.length > 0) {
                Meteor.call('budget.ensureVendors', supplierIds, (e2, vendorsMap) => {
                  if (e2) { console.error('ensureVendors failed', e2); afterVendors({}); return; }
                  afterVendors(vendorsMap || {});
                });
              } else {
                afterVendors({});
              }
            });
          }} disabled={fetching}>
            {fetching ? 'Fetching…' : 'Fetch last updates'}
          </button>
        </span>
        <span className="ml8 muted">Rows: {apiRowsVisible.length}{ignored && Number.isFinite(ignored.count) ? ` | Ignored: ${ignored.count}` : ''}</span>
        <button className="btn ml8" onClick={fetchFromApi} disabled={fetching}>Fetch by issue date</button>
        <button className="btn ml8" onClick={importFromApiCache} disabled={apiRows.length === 0}>Import from API cache</button>
        <button className="btn ml8" onClick={() => { setApiDateFrom(''); setApiDateTo(''); setApiLimit(100); setApiSearchVendor(''); setHideDuplicates(false); setHidePhotos(false); }}>Reset filters</button>
        <button className="btn ml8" onClick={loadMoreFromApi} disabled={!apiCursor || fetching}>
          {fetching ? 'Loading…' : (apiCursor ? 'Load more' : 'No more')}
        </button>
      </div>
      {apiRows.length > 0 ? (
        <div className="previewTable scrollArea" style={{ marginTop: 12 }}>
          <h4>API Preview</h4>
          {apiRange ? (
            <div className="tableMeta">Date range (API issue date): {apiRange.min} → {apiRange.max}</div>
          ) : null}
          {ignored.count > 0 ? (
            <div className="tableMeta">
              Ignored: {ignored.count} {ignored.examples.length ? `— e.g. ${ignored.examples.slice(0,5).join(', ')}` : ''}
            </div>
          ) : null}
          <div style={{ margin: '8px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                className="budgetSearch"
                placeholder="Filter vendor..."
                value={apiSearchVendor}
                onChange={(e) => setApiSearchVendor(e.target.value)}
              />
              {apiSearchVendor ? (
                <button className="btn" title="Clear" onClick={() => setApiSearchVendor('')} style={{ padding: '4px 8px' }}>×</button>
              ) : null}
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={hideDuplicates}
                onChange={(e) => setHideDuplicates(!!e.target.checked)}
              />
              Hide duplicates
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={hidePhotos}
                onChange={(e) => setHidePhotos(!!e.target.checked)}
              />
              Ignore Photo/PDF
            </label>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ignore</th>
                <th>Vendor</th>
                <th>Amount TTC</th>
                <th>Currency</th>
                <th>Invoice #</th>
                <th>Duplicate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apiRowsVisible.slice(0, 100).map((r, idx) => (
                <tr key={rowKey(r)}>
                  <td>{r.date}</td>
                  <td>
                    <button
                      className="btn"
                      title={`Ignore ${r.vendor}`}
                      onClick={() => {
                        const isPhoto = String(r.vendor || '').toLowerCase() === 'photo/pdf';
                        const payload = r.supplierId
                          ? { type: 'supplier', supplierId: r.supplierId, vendorName: r.vendor }
                          : (isPhoto && r.publicFileUrl
                              ? { type: 'photo/pdf', publicFileUrl: r.publicFileUrl, vendorName: r.vendor }
                              : { type: 'label', vendorName: r.vendor });
                        Meteor.call('budget.ignoreVendor', payload, (e4) => {
                            if (e4) { console.error('ignoreVendor failed', e4); notify({ message: 'Ignore failed', kind: 'error' }); return; }
                            notify({ message: `Ignored ${r.vendor}`, kind: 'info' });
                            // refresh ignored banner and re-filter
                            // Since we just added a new ignore rule, we need to refresh the data
                            // The subscription should automatically update, but we'll trigger a re-filter
                            setTimeout(() => {
                              // Re-filter all rows using the updated ignore list
                              const filtered = filterIgnoredItems(apiRows, { items: vendorsIgnoreData });
                              const removedCount = apiRows.length - filtered.length;
                              
                              // Calculate examples
                              const exampleNames = [];
                              const seenExamples = new Set();
                              for (const x of apiRows) {
                                const nameLower = String(x.vendor || '').trim().toLowerCase();
                                const isIgnored = !filtered.includes(x);
                                if (!isIgnored) continue;
                                const nm = String(x.vendor || (x.supplierId ? `supplier#${x.supplierId}` : ''));
                                const key = `${x.supplierId || ''}|${nm.trim().toLowerCase()}`;
                                if (seenExamples.has(key)) continue;
                                seenExamples.add(key);
                                exampleNames.push(nm);
                                if (exampleNames.length >= 5) break;
                              }
                              
                              setIgnored({ count: removedCount, examples: exampleNames.slice(0,5) });
                              setApiRows(filtered);
                            }, 100); // Small delay to ensure subscription data is updated
                          });
                      }}
                    >
                      Ignore
                    </button>
                  </td>
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
                  <td>{Number(r.amountTtc || 0).toFixed(2)}</td>
                  <td>{r.currency}</td>
                  <td>{r.invoiceNumber}</td>
                  <td>
                    {(() => {
                      const k = rowKey(r);
                      const d = dupMap[k];
                      if (!d) return '…';
                      if (d.error) return 'error';
                      return d.exists ? `yes${d.matchKind ? ` (${d.matchKind})` : ''}` : 'no';
                    })()}
                  </td>
                  <td>
                    {r.publicFileUrl ? (
                      <a
                        className="btn mr8"
                        href={r.publicFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open document"
                        onClick={(e) => { e.stopPropagation(); }}
                      >
                        Open doc
                      </a>
                    ) : null}
                    <button
                      className="btn"
                      onClick={() => {
                        Meteor.call('budget.checkDuplicate', r, (e2, res) => {
                          if (e2) { console.error('checkDuplicate failed', e2); notify({ message: 'Check failed', kind: 'error' }); return; }
                          if (res && res.exists) {
                            notify({ message: `Duplicate exists (id=${res.id || ''})`, kind: 'error' });
                          } else {
                            notify({ message: 'No duplicate found', kind: 'success' });
                          }
                        });
                      }}
                    >
                      Test dup
                    </button>
                    <button
                      className="btn ml8"
                      onClick={() => {
                        const key = rowKey(r);
                        Meteor.call('budget.importLines', { importFile: 'pennylane-api:single', lines: [r] }, (e3, res3) => {
                          if (e3) { console.error('budget.importLines failed', e3); notify({ message: 'Import failed', kind: 'error' }); return; }
                          setImportMap(prev => ({ ...prev, [key]: { imported: res3?.imported || 0, skipped: res3?.skipped || 0 } }));
                          const msg = `Imported ${res3?.imported || 0}` + ((res3?.skipped ? `, skipped ${res3.skipped}` : ''));
                          notify({ message: msg, kind: (res3?.imported ? 'success' : 'info') });
                          // Mark this row as duplicate so it can hide if toggle is enabled
                          setDupMap(prev => ({ ...prev, [key]: { exists: true, matchKind: 'imported' } }));
                        });
                      }}
                    >
                      Import row
                    </button>
                    {(() => { const k = rowKey(r); const st = importMap[k]; return st ? <span className="ml8 muted">{`[i:${st.imported||0}/s:${st.skipped||0}]`}</span> : null; })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {apiRowsVisible.length > 100 ? <p className="muted">Showing first 100 / {apiRowsVisible.length} rows</p> : <p className="muted">Rows: {apiRowsVisible.length}</p>}
          <p><strong>Total preview (API):</strong> {apiTotal.toFixed(2)} {(apiRowsVisible[0] && apiRowsVisible[0].currency) || 'EUR'}</p>
        </div>
      ) : null}
    </div>
  );
};

export default ImportTab;
