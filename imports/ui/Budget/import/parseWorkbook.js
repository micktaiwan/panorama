import * as XLSX from 'xlsx';

const safe = (v) => (v === undefined || v === null ? '' : v);

export const normalizeDateStr = (val) => {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    const o = XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function' ? XLSX.SSF.parse_date_code(val) : null;
    if (o && o.y) {
      const d = new Date(Date.UTC(o.y, (o.m || 1) - 1, o.d || 1, o.H || 0, o.M || 0, Math.floor(o.S || 0)));
      return d.toISOString().slice(0, 10);
    }
  }
  let s = String(val).trim();
  if (!s) return '';
  s = s.replace(/[\.\-]/g, '/').replace(/[\r\n]+/g, ' ').trim();
  const all = s.match(/\b([0-3]?\d)\/([0-1]?\d)\/(\d{2,4})\b/g);
  if (all && all.length > 0) {
    let best = null;
    for (const token of all) {
      const m = token.match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{2,4})$/);
      if (!m) continue;
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      let yyyy = parseInt(m[3], 10);
      if (yyyy < 100) yyyy += 2000;
      const d = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
      if (Number.isNaN(d.getTime())) continue;
      if (best === null || d > best) best = d;
    }
    if (best) return best.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
};

// Allow an optional onUnknown callback for debugging unparsable dates
export const parseWorkbook = (wb, onUnknown) => {
  const sheetByName = (name) => wb.Sheets[name] || wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase())];
  const toRows = (ws) => (ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : []);
  const shInvoices = sheetByName('invoices');
  const shLines = sheetByName('invoice lines');
  const shAnalytics = sheetByName('Analytics');
  const invoices = toRows(shInvoices);
  const lines = toRows(shLines);
  const analytics = toRows(shAnalytics);

  const normalizeKey = (k) => String(k || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const makeGetter = (row) => {
    const map = new Map();
    Object.keys(row || {}).forEach((k) => { map.set(k, row[k]); map.set(normalizeKey(k), row[k]); });
    return (candidates) => {
      for (const k of candidates) {
        if (map.has(k)) return map.get(k);
        const nk = normalizeKey(k);
        if (map.has(nk)) return map.get(nk);
      }
      return '';
    };
  };

  const invById = new Map();
  invoices.forEach((r) => {
    const get = makeGetter(r);
    const id = String(safe(get(['Invoice ID', 'invoice id', 'invoiceId', 'Id facture', 'ID facture']))).trim();
    if (id) invById.set(id, r);
  });
  const analyticsByInv = new Map();
  analytics.forEach((r) => {
    const get = makeGetter(r);
    const id = String(safe(get(['Invoice ID', 'invoice id', 'invoiceId', 'Id facture', 'ID facture']))).trim();
    if (!id) return;
    const arr = analyticsByInv.get(id) || [];
    arr.push(r);
    analyticsByInv.set(id, arr);
  });

  const preview = lines.map((ln) => {
    const getLn = makeGetter(ln);
    const invoiceId = String(safe(getLn(['Invoice ID', 'invoice id', 'invoiceId', 'Id facture', 'ID facture']))).trim();
    const invoiceNumber = String(safe(getLn(['Invoice number', 'invoice number', 'Numéro facture', 'Numero facture', 'N facture']))).trim();
    const inv = invoiceId ? invById.get(invoiceId) : undefined;
    const an = invoiceId ? (analyticsByInv.get(invoiceId) || []) : [];

    let analyticsCategory = '';
    let analyticsWeight;
    if (an.length > 0) {
      const withWeight = an.map((a) => {
        const getAn = makeGetter(a);
        const cat = String(safe(getAn(['Category', 'Categorie', 'Analytical category']))).trim();
        const wRaw = getAn(['Weight (Category)', 'Poids (Categorie)', 'Weight']);
        const w = Number(String(safe(wRaw)).replace(',', '.')) || 0;
        return { cat, w };
      });
      withWeight.sort((a, b) => b.w - a.w);
      if (withWeight[0]) {
        analyticsCategory = withWeight[0].cat;
        analyticsWeight = withWeight[0].w;
      }
    }

    const num = (v) => {
      const s = String(safe(v)).replace(/\s/g, '').replace(',', '.');
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };
    const amountInclVat = num(getLn(['Amount incl. VAT', 'Amount TTC', 'Montant TTC', 'TTC', 'amountInclVat', 'amountTtc']));
    const vat = num(getLn(['VAT', 'TVA', 'Montant TVA', 'vat']));
    let currency = String(safe(getLn(['Currency', 'Devise', 'currency']))).trim() || 'EUR';
    if (currency === '€') currency = 'EUR';
    const getInv = makeGetter(inv || {});
    let vendor = inv ? String(safe(getInv(['Thirdparty', 'Tiers', 'Supplier', 'Supplier name', 'Fournisseur']))).trim() : '';
    if (!vendor && an.length > 0) {
      const getAn0 = makeGetter(an[0]);
      vendor = String(safe(getAn0(['Supplier', 'Fournisseur', 'Thirdparty']))).trim();
    }
    const paymentRaw = inv ? getInv(['Payment date', 'Date de paiement']) || '' : '';
    const issueRaw = inv ? getInv(['Date', 'Issue date']) || '' : '';
    const lineDate = getLn(['Import date', 'Date d import', 'Date of modification', 'Date de modification', 'date']) || '';

    const payIso = normalizeDateStr(paymentRaw);
    const issueIso = normalizeDateStr(issueRaw);
    let normalized = '';
    let chosenSource = 'none';
    if (payIso && issueIso) {
      normalized = payIso > issueIso ? payIso : issueIso;
      chosenSource = payIso > issueIso ? 'paymentRaw' : 'dateRaw';
    } else if (payIso) {
      normalized = payIso;
      chosenSource = 'paymentRaw';
    } else if (issueIso) {
      normalized = issueIso;
      chosenSource = 'dateRaw';
    } else {
      const impIso = normalizeDateStr(lineDate);
      normalized = impIso;
      chosenSource = impIso ? 'importRaw' : 'none';
    }
    if (normalized === '' && typeof onUnknown === 'function') {
      onUnknown({
        invoiceId,
        invoiceNumber,
        vendor,
        paymentRaw,
        dateRaw: issueRaw,
        importRaw: lineDate,
      });
    }

    return {
      date: normalized,
      vendor: vendor,
      category: '',
      autoCategory: analyticsCategory || '',
      amountTtc: amountInclVat,
      vat,
      currency,
      invoiceId,
      invoiceNumber,
      analyticsCategory: analyticsCategory || '',
      analyticsWeight,
      sourceRef: invoiceNumber || '',
      paymentRaw,
      dateRaw: issueRaw,
      importRaw: lineDate,
      chosenSource,
    };
  });

  return preview;
};


