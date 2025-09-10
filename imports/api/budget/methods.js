import { Meteor } from 'meteor/meteor';
import { getPennylaneConfig } from '/imports/api/_shared/config';
import { check } from 'meteor/check';
import { fetch } from 'meteor/fetch';
import { BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection } from './collections';

const toCents = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
};

const normalizeDate = (input) => {
  if (!input) return undefined;
  if (input instanceof Date) {
    const iso = input.toISOString();
    return iso.slice(0, 10);
  }
  let s = String(input).trim();
  if (!s) return undefined;
  // Normalize separators (dot -> slash), keep dashes for ISO; collapse newlines
  s = s.replace(/[\.]/g, '/').replace(/[\r\n]+/g, ' ').trim();
  // Handle ISO yyyy-mm-dd explicitly to avoid tz quirks
  let mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) {
    const yyyy = parseInt(mIso[1], 10);
    const mm = parseInt(mIso[2], 10);
    const dd = parseInt(mIso[3], 10);
    const d = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
    return d.toISOString().slice(0, 10);
  }
  // Extract all FR-like dates and pick the latest
  const matches = s.match(/\b([0-3]?\d)\/([0-1]?\d)\/(\d{2,4})\b/g);
  if (matches && matches.length > 0) {
    let best = null;
    for (const token of matches) {
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
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
};

const buildDedupeHash = (line) => {
  const key = [line.date || '', line.amountCents || 0, line.vendor || ''].join('|').toLowerCase();
  return key.replace(/\s+/g, ' ').trim();
};

// Shared duplicate check core used by multiple methods
const checkDuplicateCore = async (line) => {
  const dateIso = normalizeDate(line.date);
  const vendor = String(line.vendor || '').trim();
  const amountCents = toCents(line.amountTtc ?? line.amount);
  const probe = { date: dateIso || '', vendor, amountCents };
  const dedupeHash = buildDedupeHash(probe);
  const byHash = await BudgetLinesCollection.findOneAsync({ dedupeHash });

  // Fallback 1: invoice number exact match when available
  let byInvoice = null;
  const invoiceNumber = (line && line.invoiceNumber) ? String(line.invoiceNumber).trim() : '';
  if (!byHash && invoiceNumber) {
    byInvoice = await BudgetLinesCollection.findOneAsync({ invoiceNumber });
  }

  // Fallback 2: relaxed vendor (case-insensitive, trimmed) AND amount only
  let candidates = [];
  if (!byHash && !byInvoice && vendor && Number.isFinite(amountCents)) {
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^\\s*${escapeRegex(vendor)}\\s*$`, 'i');
    const cursor = BudgetLinesCollection.find({ vendor: rx, amountCents }, { fields: { _id: 1, date: 1, vendor: 1, invoiceNumber: 1 }, limit: 5 });
    candidates = cursor.fetch();
  }

  // Fallback 3: aggregated match – Excel may split invoices that API consolidates
  // Sum all lines for same vendor within a small date window (±N days), see settings.budget.duplicateWindowDays (default 2)
  let sumGroup = null;
  if (!byHash && !byInvoice && vendor && Number.isFinite(amountCents) && (dateIso || '') !== '') {
    const windowDays = (Meteor.settings && Meteor.settings.budget && Number.isFinite(Number(Meteor.settings.budget.duplicateWindowDays))) ? Number(Meteor.settings.budget.duplicateWindowDays) : 2;
    const [yyyy, mm, dd] = String(dateIso).split('-').map((s) => parseInt(s, 10));
    const base = new Date(Date.UTC(yyyy, (mm || 1) - 1, dd || 1));
    const fromD = new Date(base); fromD.setUTCDate(fromD.getUTCDate() - windowDays);
    const toD = new Date(base); toD.setUTCDate(toD.getUTCDate() + windowDays);
    const toIso = (d) => d.toISOString().slice(0, 10);
    const fromIso = toIso(fromD);
    const toIsoStr = toIso(toD);
    const raw = await BudgetLinesCollection.rawCollection().aggregate([
      { $match: { vendor, date: { $gte: fromIso, $lte: toIsoStr } } },
      { $group: { _id: null, total: { $sum: '$amountCents' }, ids: { $addToSet: '$_id' }, count: { $sum: 1 } } }
    ]).toArray();
    if (raw && raw.length > 0) {
      const g = raw[0];
      if (Number(g.total) === Number(amountCents)) {
        sumGroup = { total: g.total, count: g.count, ids: g.ids, windowDays };
      }
    }
  }

  const match = byHash || byInvoice || (sumGroup ? { _id: sumGroup.ids && sumGroup.ids[0] } : null);
  const matchKind = byHash ? 'hash' : (byInvoice ? 'invoiceNumber' : (sumGroup ? 'sumVendorDate' : (candidates.length ? 'fuzzyVendorAmount' : 'none')));
  return { exists: !!match, id: match ? match._id : undefined, matchKind, dedupeHash, probe, candidates, sumGroup };
};

Meteor.methods({
  async 'budget.importLines'(payload) {
    check(payload, {
      importFile: String,
      lines: [Object],
    });

    const importBatch = `batch_${Date.now()}`;
    const now = new Date();

    const docs = [];
    const unknownDates = [];
    const vendorClassCache = new Map(); // vendor -> { department?, team? }
    for (const raw of payload.lines) {
      const dateIso = normalizeDate(raw.date || raw.paymentDate || raw.issueDate);
      const doc = {
        date: dateIso || '',
        vendor: String(raw.vendor || raw.thirdparty || raw.supplier || '').trim(),
        category: String(raw.category || '').trim() || undefined,
        autoCategory: String(raw.autoCategory || raw.analyticsCategory || '').trim() || undefined,
        amountCents: toCents(raw.amountTtc ?? raw.amountInclVat ?? raw.amount),
        vatCents: Number.isFinite(Number(raw.vat)) ? toCents(raw.vat) : undefined,
        currency: String(raw.currency || 'EUR').trim(),
        projectId: raw.projectId ? String(raw.projectId) : undefined,
        invoiceId: raw.invoiceId ? String(raw.invoiceId) : undefined,
        invoiceNumber: raw.invoiceNumber ? String(raw.invoiceNumber) : undefined,
        publicFileUrl: raw.publicFileUrl ? String(raw.publicFileUrl) : (raw.public_file_url ? String(raw.public_file_url) : undefined),
        analyticsCategory: raw.analyticsCategory ? String(raw.analyticsCategory) : undefined,
        analyticsWeight: Number.isFinite(Number(raw.analyticsWeight)) ? Number(raw.analyticsWeight) : undefined,
        sourceRef: raw.sourceRef ? String(raw.sourceRef) : undefined,
        importBatch,
        importFile: payload.importFile,
        importedAt: now,
        dedupeHash: '',
        createdAt: now,
        updatedAt: now,
      };
      // Inherit prior classification by vendor (department/team)
      if (doc.vendor) {
        let cls = vendorClassCache.get(doc.vendor);
        if (cls === undefined) {
          const prev = await BudgetLinesCollection.findOneAsync({ vendor: doc.vendor }, { fields: { department: 1, team: 1 } });
          cls = prev ? { department: prev.department, team: prev.team } : null;
          vendorClassCache.set(doc.vendor, cls);
        }
        if (cls) {
          if (cls.team) doc.team = String(cls.team).toLowerCase();
          if (cls.department) doc.department = String(cls.department);
        }
      }
      if (!dateIso) {
        unknownDates.push({
          vendor: doc.vendor,
          dateRaw: raw.date,
          invoiceId: doc.invoiceId,
          invoiceNumber: doc.invoiceNumber,
        });
      }
      doc.dedupeHash = buildDedupeHash(doc);
      docs.push(doc);
    }

    // naive dedupe within this batch
    const unique = [];
    const seen = new Set();
    for (const d of docs) {
      const k = d.dedupeHash;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(d);
    }

    let importedCount = 0;
    let skippedExisting = 0;
    for (const doc of unique) {
      const exists = await BudgetLinesCollection.findOneAsync({ dedupeHash: doc.dedupeHash });
      if (exists) { skippedExisting += 1; continue; }
      await BudgetLinesCollection.insertAsync(doc);
      importedCount += 1;
    }

    if (unknownDates.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[budget][server][import] unknown date count:', unknownDates.length, 'file:', payload.importFile);
      // eslint-disable-next-line no-console
      console.warn('[budget][server][import] unknown samples (up to 10):', unknownDates.slice(0, 10));
    }

    return { imported: importedCount, skipped: skippedExisting, importBatch, unknownDates: unknownDates.length, unknownSamples: unknownDates.slice(0, 10) };
  },
  async 'budget.setDepartment'(lineId, department) {
    check(lineId, String);
    check(department, String);
    const allowed = ['tech', 'parked', 'product', 'other'];
    const dep = allowed.includes(department) ? department : 'tech';
    const now = new Date();
    // Always update the target line
    if (dep === 'parked') {
      await BudgetLinesCollection.updateAsync({ _id: lineId }, { $set: { department: dep, updatedAt: now }, $unset: { team: '' } });
    } else {
      await BudgetLinesCollection.updateAsync({ _id: lineId }, { $set: { department: dep, updatedAt: now } });
    }

    // Bulk update all lines with the same vendor
    let bulkCount = 0;
    const base = await BudgetLinesCollection.findOneAsync({ _id: lineId });
    if (base) {
      const selector = {
        _id: { $ne: lineId }
      };
      const vendor = (base.vendor || '').trim();
      if (vendor) selector.vendor = vendor; else selector.vendor = { $exists: false };
      
      if (dep === 'parked') {
        const res = await BudgetLinesCollection.rawCollection().updateMany(selector, { $set: { department: 'parked', updatedAt: now }, $unset: { team: '' } });
        bulkCount = res && (res.modifiedCount || 0);
      } else {
        const res = await BudgetLinesCollection.rawCollection().updateMany(selector, { $set: { department: dep, updatedAt: now } });
        bulkCount = res && (res.modifiedCount || 0);
      }
    }
    return { ok: 1, bulkUpdated: bulkCount };
  },
  async 'budget.resetAll'() {
    // Danger: deletes all budget lines
    const res = await BudgetLinesCollection.rawCollection().deleteMany({});
    return { ok: 1, deleted: (res?.deletedCount ?? 0) };
  },
  async 'budget.removeLine'(lineId) {
    check(lineId, String);
    const res = await BudgetLinesCollection.removeAsync({ _id: lineId });
    return { ok: 1, deleted: res };
  },
  async 'budget.setTeam'(lineId, team) {
    check(lineId, String);
    check(team, String);
    const allowed = ['lemapp', 'sre', 'data', 'pony', 'cto'];
    const t = allowed.includes(team.toLowerCase()) ? team.toLowerCase() : undefined;
    if (!t) throw new Meteor.Error('invalid-team', 'Unknown team');
    const now = new Date();

    // Set on target line and mark as tech
    await BudgetLinesCollection.updateAsync({ _id: lineId }, { $set: { team: t, department: 'tech', updatedAt: now } });

    // Bulk apply to similar lines (same vendor)
    const base = await BudgetLinesCollection.findOneAsync({ _id: lineId });
    if (!base) return { ok: 1, bulkUpdated: 0 };
    const selector = {
      _id: { $ne: lineId }
    };
    const vendor = (base.vendor || '').trim();
    if (vendor) selector.vendor = vendor; else selector.vendor = { $exists: false };
    const res = await BudgetLinesCollection.rawCollection().updateMany(selector, { $set: { team: t, department: 'tech', updatedAt: now } });
    const bulkCount = res && (res.modifiedCount || 0);
    return { ok: 1, bulkUpdated: bulkCount };
  },
  async 'budget.testPennylaneApi'() {
    const cfg = getPennylaneConfig();
    const baseUrlRaw = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
    const baseUrl = baseUrlRaw.replace(/\/+$/g, '');
    const token = cfg.token || cfg.apiKey;

    if (!baseUrl || !token) {
      throw new Meteor.Error('config-missing', 'Configure pennylane.baseUrl and pennylane.token in settings.json');
    }

    // Build URL from base and optional testPath (default endpoint below)
    // Default to supplier invoices listing for External V2 API
    const testPathRaw = typeof cfg.testPath === 'string' ? cfg.testPath : 'supplier_invoices?sort=-id';
    const testPath = String(testPathRaw || '').replace(/^\//, '');
    const url = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${testPath}`;
    console.log('url', url);
    try {
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Panorama/Dev'
      };
      const authMode = String(cfg.authMode || 'bearer').toLowerCase();
      if (authMode === 'x-api-key') headers['X-Api-Key'] = token; else headers['Authorization'] = `Bearer ${token}`;
      if (cfg.organizationId) headers['X-Organization-Id'] = String(cfg.organizationId);

      const res = await fetch(url, {
        method: 'GET',
        headers
      });
      const status = res.status;
      const ok = res.ok;
      let body = null;
      const contentType = (res.headers && typeof res.headers.get === 'function') ? res.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) {
        try {
          body = await res.json();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[budget][server] Failed to parse Pennylane JSON response', e);
          body = null;
        }
      } else {
        try {
          body = await res.text();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[budget][server] Failed to read Pennylane text response', e);
          body = null;
        }
      }
      if (!ok) {
        throw new Meteor.Error('pennylane-error', `HTTP ${status}`, { status, body });
      }
      let sample = null;
      if (body && Array.isArray(body.data)) {
        sample = body.data[0] || null;
      } else if (body && Array.isArray(body)) {
        sample = body[0] || null;
      } else {
        sample = body || null;
      }
      // Log the full response body for debugging (no preview), and indicate type
      try {
        let bodyType = typeof body;
        if (contentType && typeof contentType === 'string') {
          if (contentType.includes('application/json')) bodyType = 'json';
          else bodyType = contentType;
        } else if (Array.isArray(body)) {
          bodyType = 'array';
        }
        // eslint-disable-next-line no-console
        console.log('[budget][server] Pennylane test OK META', { status, url, bodyType });
        // eslint-disable-next-line no-console
        console.dir(body, { depth: null, maxArrayLength: null });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[budget][server] Failed to log Pennylane full response', e);
      }
      return { ok: true, status, url, sample: sample ? JSON.parse(JSON.stringify(sample)) : null };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[budget][server] testPennylaneApi failed:', err);
      const reason = err && err.reason ? err.reason : (err && err.message) ? err.message : 'request failed';
      throw new Meteor.Error('pennylane-request-failed', reason);
    }
  },
  async 'budget.fetchPennylaneSupplierInvoices'(cursor, perPage, filters) {
    const cfg = getPennylaneConfig();
    const baseUrlRaw = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
    const baseUrl = baseUrlRaw.replace(/\/+$/g, '/');
    const token = cfg.token || cfg.apiKey;

    if (!baseUrl || !token) {
      throw new Meteor.Error('config-missing', 'Configure pennylane.baseUrl and pennylane.token in settings.json');
    }

    const qp = new URLSearchParams();
    qp.set('sort', '-date');
    qp.set('limit', String(Number(perPage) > 0 ? Number(perPage) : 100));
    if (cursor) qp.set('cursor', String(cursor));
    // Optional date range filters via `filter` param (array of {field,operator,value})
    if (filters && typeof filters === 'object') {
      const from = filters.date_from || filters.dateFrom;
      const to = filters.date_to || filters.dateTo;
      const filterArr = [];
      if (from) filterArr.push({ field: 'date', operator: 'gteq', value: String(from) });
      if (to) filterArr.push({ field: 'date', operator: 'lteq', value: String(to) });
      if (filterArr.length > 0) qp.set('filter', JSON.stringify(filterArr));
    }
    const url = `${baseUrl}supplier_invoices?${qp.toString()}`;
    console.log('url', url);
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Panorama/Dev'
    };
    const authMode = String(cfg.authMode || 'bearer').toLowerCase();
    if (authMode === 'x-api-key') headers['X-Api-Key'] = token; else headers['Authorization'] = `Bearer ${token}`;
    if (cfg.organizationId) headers['X-Organization-Id'] = String(cfg.organizationId);

    try {
      const res = await fetch(url, { method: 'GET', headers });
      const status = res.status;
      const ok = res.ok;
      let body = null;
      const contentType = (res.headers && typeof res.headers.get === 'function') ? res.headers.get('content-type') : null;
      if (contentType && contentType.includes('application/json')) body = await res.json(); else body = await res.text();
      if (!ok) {
        throw new Meteor.Error('pennylane-error', `HTTP ${status}`, { status, body });
      }
      try {
        if (body && Array.isArray(body.items)) {
          const supplierIds = Array.from(new Set(body.items.map((it) => it && it.supplier && it.supplier.id).filter(Boolean))).map(String);
          const supplierMap = {};
          if (supplierIds.length > 0) {
            try {
              const rows = await VendorsCacheCollection.rawCollection().find({ supplierId: { $in: supplierIds } }, { projection: { supplierId: 1, name: 1 } }).toArray();
              for (const r of rows) { if (r && r.supplierId) supplierMap[String(r.supplierId)] = r.name; }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[budget][server] vendor cache read failed', e);
            }
          }
          const guessVendorFromLabel = (label, filename, externalReference) => {
            const base = String(label || externalReference || filename || '').trim();
            if (!base) return '';
            let s = base;
            s = s.replace(/\(label généré\)/ig, '');
            s = s.replace(/\([^)]*\)\s*$/g, '');
            s = s.replace(/^Facture\s+/i, '').trim();
            const parts = s.split(/\s*[\-–—]\s*/).filter(Boolean);
            if (parts.length > 0) return parts[0].trim();
            return s.trim();
          };
          const empties = [];
          for (const it of body.items) {
            const sid = it && it.supplier && it.supplier.id;
            let vendorName = sid ? supplierMap[String(sid)] : '';
            if (!vendorName) vendorName = guessVendorFromLabel(it && it.label, it && it.filename, it && it.external_reference);
            if (!vendorName) {
              empties.push({
                id: it && it.id,
                invoice_number: it && it.invoice_number,
                label: it && it.label,
                filename: it && it.filename,
                external_reference: it && it.external_reference,
                supplier: it && it.supplier,
                payment_status: it && it.payment_status,
                public_file_url: it && it.public_file_url,
              });
            }
          }
          if (empties.length > 0) {
            // eslint-disable-next-line no-console
            console.warn('[budget][server] API items with empty vendor after fallback', { count: empties.length });
            // eslint-disable-next-line no-console
            console.dir(empties.slice(0, 20), { depth: null, maxArrayLength: null });
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[budget][server] vendor-empty logging failed', e);
      }
      return body;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[budget][server] fetchPennylaneSupplierInvoices failed:', err);
      const reason = err && err.reason ? err.reason : (err && err.message) ? err.message : 'request failed';
      throw new Meteor.Error('pennylane-request-failed', reason);
    }
  },
  async 'budget.ensureVendors'(supplierIds) {
    if (!Array.isArray(supplierIds)) throw new Meteor.Error('invalid-args', 'supplierIds must be an array');
    const cfg = getPennylaneConfig();
    const baseUrlRaw = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
    const baseUrl = baseUrlRaw.replace(/\/+$/g, '/');
    const token = cfg.token || cfg.apiKey;
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Panorama/Dev'
    };
    const authMode = String(cfg.authMode || 'bearer').toLowerCase();
    if (authMode === 'x-api-key') headers['X-Api-Key'] = token; else headers['Authorization'] = `Bearer ${token}`;
    if (cfg.organizationId) headers['X-Organization-Id'] = String(cfg.organizationId);

    const results = {};
    for (const sid of supplierIds) {
      const supplierId = String(sid);
      const existing = await VendorsCacheCollection.findOneAsync({ supplierId });
      if (existing && existing.name) { results[supplierId] = existing.name; continue; }
      const url = `${baseUrl}suppliers/${encodeURIComponent(supplierId)}`;
      try {
        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.warn('[budget][server] supplier fetch failed', supplierId, res.status);
          continue;
        }
        const body = await res.json();
        const name = body && (body.name || body.legal_name || body.label || body.display_name || body.company_name);
        if (name) {
          const doc = { supplierId, name: String(name), updatedAt: new Date() };
          await VendorsCacheCollection.updateAsync({ supplierId }, { $set: doc }, { upsert: true });
          results[supplierId] = doc.name;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[budget][server] supplier fetch error', supplierId, e);
      }
    }
    return results;
  },
  async 'budget.checkDuplicate'(line) {
    if (!line || (typeof line !== 'object')) throw new Meteor.Error('invalid-args', 'line must be an object');
    return await checkDuplicateCore(line);
  }
  ,
  async 'budget.ignoreVendor'(payload) {
    const kind = payload && payload.type ? String(payload.type) : (payload && payload.supplierId ? 'supplier' : 'label');
    const doc = {
      type: kind,
      supplierId: payload && payload.supplierId ? String(payload.supplierId) : undefined,
      vendorName: payload && payload.vendorName ? String(payload.vendorName) : undefined,
      vendorNameLower: payload && payload.vendorName ? String(payload.vendorName).trim().toLowerCase() : undefined,
      publicFileUrl: payload && payload.publicFileUrl ? String(payload.publicFileUrl) : undefined,
      createdAt: new Date()
    };
    if (!doc.supplierId && !doc.vendorNameLower && !doc.publicFileUrl) {
      throw new Meteor.Error('invalid-args', 'supplierId or vendorName or publicFileUrl required');
    }
    await VendorsIgnoreCollection.insertAsync(doc);
    return { ok: 1 };
  },
  async 'budget.fetchVendorsIgnore'() {
    const rows = await VendorsIgnoreCollection.find({}).fetchAsync();
    return { items: rows };
  }
});

// Last updates (changelog-based) fetch
Meteor.methods({
  async 'budget.fetchPennylaneLastUpdates'(startDate, perPage) {
    // eslint-disable-next-line no-console
    console.log('[budget][server] fetchPennylaneLastUpdates CALLED', { startDate, perPage });
    
    const cfg = (Meteor.settings && Meteor.settings.pennylane) || {};
    const baseUrlRaw = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
    const baseUrl = baseUrlRaw.replace(/\/+$/g, '/');
    const token = cfg.token || cfg.apiKey;

    if (!baseUrl || !token) {
      throw new Meteor.Error('config-missing', 'Configure pennylane.baseUrl and pennylane.token in settings.json');
    }

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'Panorama/Dev'
    };
    const authMode = String(cfg.authMode || 'bearer').toLowerCase();
    if (authMode === 'x-api-key') headers['X-Api-Key'] = token; else headers['Authorization'] = `Bearer ${token}`;
    if (cfg.organizationId) headers['X-Organization-Id'] = String(cfg.organizationId);

    const qp = new URLSearchParams();
    qp.set('limit', String(Number(perPage) > 0 ? Number(perPage) : 100));
    const toIsoStart = (s) => {
      if (!s) return undefined;
      const ss = String(s);
      return ss.includes('T') ? ss : `${ss}T00:00:00Z`;
    };
    const sd = toIsoStart(startDate);
    if (sd) qp.set('start_date', sd);

    const url = `${baseUrl}changelogs/supplier_invoices?${qp.toString()}`;
    
    // eslint-disable-next-line no-console
    console.log('[budget][server] fetchPennylaneLastUpdates STEP 1 - Fetching changelogs');
    // eslint-disable-next-line no-console
    console.log('[budget][server] REQUEST URL:', url);
    // eslint-disable-next-line no-console
    console.log('[budget][server] REQUEST HEADERS:', headers);
    // eslint-disable-next-line no-console
    console.log('[budget][server] REQUEST PARAMS:', { startDate, perPage, processedStartDate: sd });
    
    const res = await fetch(url, { method: 'GET', headers });
    
    // eslint-disable-next-line no-console
    console.log('[budget][server] RESPONSE STATUS:', res.status, res.statusText);
    // eslint-disable-next-line no-console
    console.log('[budget][server] RESPONSE HEADERS:', Object.fromEntries(res.headers.entries()));
    
    if (!res.ok) {
      const body = await res.text();
      // eslint-disable-next-line no-console
      console.error('[budget][server] ERROR RESPONSE BODY:', body);
      throw new Meteor.Error('pennylane-error', `HTTP ${res.status}`, { status: res.status, body });
    }
    
    const body = await res.json();
    // eslint-disable-next-line no-console
    console.log('[budget][server] RESPONSE BODY (changelogs):', JSON.stringify(body, null, 2));
    
    const changeItems = Array.isArray(body && body.items) ? body.items : [];
    const ids = Array.from(new Set(changeItems.map((x) => x && x.id).filter(Boolean)));
    
    // eslint-disable-next-line no-console
    console.log('[budget][server] EXTRACTED IDS:', ids);
    
    if (ids.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[budget][server] NO IDS FOUND - returning empty result');
      return { items: [], next_cursor: body && body.next_cursor };
    }

    // Fetch details by ids
    const qp2 = new URLSearchParams();
    qp2.set('limit', String(ids.length));
    qp2.set('filter', JSON.stringify([{ field: 'id', operator: 'in', value: ids }]));
    const url2 = `${baseUrl}supplier_invoices?${qp2.toString()}`;
    
    // eslint-disable-next-line no-console
    console.log('[budget][server] fetchPennylaneLastUpdates STEP 2 - Fetching details');
    // eslint-disable-next-line no-console
    console.log('[budget][server] REQUEST URL2:', url2);
    // eslint-disable-next-line no-console
    console.log('[budget][server] REQUEST PARAMS2:', { limit: ids.length, filter: JSON.stringify([{ field: 'id', operator: 'in', value: ids }]) });
    
    const res2 = await fetch(url2, { method: 'GET', headers });
    
    // eslint-disable-next-line no-console
    console.log('[budget][server] RESPONSE2 STATUS:', res2.status, res2.statusText);
    
    if (!res2.ok) {
      const body2 = await res2.text();
      // eslint-disable-next-line no-console
      console.error('[budget][server] ERROR RESPONSE2 BODY:', body2);
      throw new Meteor.Error('pennylane-error', `HTTP ${res2.status}`, { status: res2.status, body: body2 });
    }
    
    const body2 = await res2.json();
    // eslint-disable-next-line no-console
    console.log('[budget][server] RESPONSE2 BODY (details) - item count:', (body2 && body2.items && body2.items.length) || 0);
    // eslint-disable-next-line no-console
    console.dir(body2, { depth: null, maxArrayLength: null });
    
    const result = { items: Array.isArray(body2 && body2.items) ? body2.items : [], next_cursor: body && body.next_cursor };
    // eslint-disable-next-line no-console
    console.log('[budget][server] fetchPennylaneLastUpdates FINAL RESULT:', { itemCount: result.items.length, next_cursor: result.next_cursor });
    
    return result;
  }
});
