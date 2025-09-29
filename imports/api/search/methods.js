import { Meteor } from 'meteor/meteor';
import { getQdrantUrl } from '/imports/api/_shared/config';
import { check } from 'meteor/check';
import { getQdrantClient, COLLECTION, VECTOR_SIZE, DISTANCE, embedText, makePreview, toPointId, splitIntoChunks, deleteByKind } from './vectorStore';

// primitives are imported from './vectorStore'

// In-memory LRU cache for query vectors
const VECTOR_CACHE_MAX = 2000;
const vectorCache = new Map(); // key -> { vec: number[], at: number }
const inFlightVectors = new Map(); // key -> Promise<number[]>
const normalizeQuery = (q) => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const getQueryVector = async (rawQuery) => {
  const key = `v1|${normalizeQuery(rawQuery)}`;
  if (vectorCache.has(key)) {
    const hit = vectorCache.get(key);
    // refresh LRU order
    vectorCache.delete(key);
    vectorCache.set(key, { vec: hit.vec, at: Date.now() });
    return { vector: hit.vec, cached: true };
  }
  if (inFlightVectors.has(key)) {
    const vec = await inFlightVectors.get(key);
    return { vector: vec, cached: true };
  }
  const p = (async () => embedText(rawQuery))();
  inFlightVectors.set(key, p);
  try {
    const vec = await p;
    vectorCache.set(key, { vec, at: Date.now() });
    // LRU cap
    if (vectorCache.size > VECTOR_CACHE_MAX) {
      const oldestKey = vectorCache.keys().next().value;
      vectorCache.delete(oldestKey);
    }
    return { vector: vec, cached: false };
  } finally {
    inFlightVectors.delete(key);
  }
};

// simple in-memory job tracking (server lifetime)
const indexJobs = new Map(); // jobId -> { total, processed, upserts, errors, startedAt, finishedAt, done, cancelled }
const jobCancellation = new Map(); // jobId -> AbortController

const collectDocs = async () => {
  const docs = [];
  const pushDoc = (id, projectId, kind, text, meta = {}) => {
    const content = String(text || '').trim();
    if (!content) return;
    docs.push({ id: `${kind}:${id}`, projectId: projectId || null, kind, content, meta });
  };
  const { ProjectsCollection } = await import('/imports/api/projects/collections');
  const { TasksCollection } = await import('/imports/api/tasks/collections');
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
  const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
  const { LinksCollection } = await import('/imports/api/links/collections');
  const { UserLogsCollection } = await import('/imports/api/userLogs/collections');

  const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
  projects.forEach(p => pushDoc(p._id, p._id, 'project', `${p.name || ''} ${p.description || ''}`));
  const tasks = await TasksCollection.find({}, { fields: { title: 1, notes: 1, projectId: 1 } }).fetchAsync();
  tasks.forEach(t => pushDoc(t._id, t.projectId, 'task', `${t.title || ''} ${t.notes || ''}`));
  const notes = await NotesCollection.find({}, { fields: { content: 1, projectId: 1, title: 1 } }).fetchAsync();
  notes.forEach(n => {
    const base = `${n.title || ''} ${n.content || ''}`;
    const chunks = splitIntoChunks(base);
    chunks.forEach((chunk, i) => pushDoc(n._id, n.projectId, 'note', chunk, { chunkIndex: i }));
  });
  const sessions = await NoteSessionsCollection.find({}, { fields: { aiSummary: 1, projectId: 1, name: 1 } }).fetchAsync();
  sessions.forEach(s => pushDoc(s._id, s.projectId, 'session', `${s.name || ''} ${s.aiSummary || ''}`));
  const lines = await NoteLinesCollection.find({}, { fields: { content: 1, sessionId: 1 } }).fetchAsync();
  lines.forEach(l => pushDoc(l._id, null, 'line', l.content || '', { sessionId: l.sessionId || null }));
  // Alarms are not indexed - they are temporary notifications
  const links = await LinksCollection.find({}, { fields: { name: 1, url: 1, projectId: 1 } }).fetchAsync();
  links.forEach(l => pushDoc(l._id, l.projectId, 'link', `${l.name || ''} ${l.url || ''}`));
  const userLogs = await UserLogsCollection.find({}, { fields: { content: 1 } }).fetchAsync();
  userLogs.forEach(ul => pushDoc(ul._id, null, 'userlog', ul.content || ''));
  return docs;
};

// Collect docs for a specific kind only
const collectDocsByKind = async (kind) => {
  const docs = [];
  const pushDoc = (id, projectId, kindKey, text, meta = {}) => {
    const content = String(text || '').trim();
    if (!content) return;
    docs.push({ id: `${kindKey}:${id}`, projectId: projectId || null, kind: kindKey, content, meta });
  };
  switch (kind) {
    case 'project': {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const items = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
      items.forEach(p => pushDoc(p._id, p._id, 'project', `${p.name || ''} ${p.description || ''}`));
      break;
    }
    case 'task': {
      const { TasksCollection } = await import('/imports/api/tasks/collections');
      const items = await TasksCollection.find({}, { fields: { title: 1, notes: 1, projectId: 1 } }).fetchAsync();
      items.forEach(t => pushDoc(t._id, t.projectId, 'task', `${t.title || ''} ${t.notes || ''}`));
      break;
    }
    case 'note': {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      const items = await NotesCollection.find({}, { fields: { content: 1, projectId: 1, title: 1 } }).fetchAsync();
      items.forEach(n => {
        const base = `${n.title || ''} ${n.content || ''}`;
        const chunks = splitIntoChunks(base);
        chunks.forEach((chunk, i) => pushDoc(n._id, n.projectId, 'note', chunk, { chunkIndex: i }));
      });
      break;
    }
    case 'session': {
      const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
      const items = await NoteSessionsCollection.find({}, { fields: { aiSummary: 1, projectId: 1, name: 1 } }).fetchAsync();
      items.forEach(s => pushDoc(s._id, s.projectId, 'session', `${s.name || ''} ${s.aiSummary || ''}`));
      break;
    }
    case 'line': {
      const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
      const items = await NoteLinesCollection.find({}, { fields: { content: 1, sessionId: 1 } }).fetchAsync();
      items.forEach(l => pushDoc(l._id, null, 'line', l.content || '', { sessionId: l.sessionId || null }));
      break;
    }
    case 'alarm': {
      const { AlarmsCollection } = await import('/imports/api/alarms/collections');
      const items = await AlarmsCollection.find({}, { fields: { title: 1 } }).fetchAsync();
      items.forEach(a => pushDoc(a._id, null, 'alarm', a.title || ''));
      break;
    }
    case 'link': {
      const { LinksCollection } = await import('/imports/api/links/collections');
      const items = await LinksCollection.find({}, { fields: { name: 1, url: 1, projectId: 1 } }).fetchAsync();
      items.forEach(l => pushDoc(l._id, l.projectId, 'link', `${l.name || ''} ${l.url || ''}`));
      break;
    }
    case 'userlog': {
      const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
      const items = await UserLogsCollection.find({}, { fields: { content: 1 } }).fetchAsync();
      items.forEach(ul => pushDoc(ul._id, null, 'userlog', ul.content || ''));
      break;
    }
    default:
      break;
  }
  return docs;
};

// use toPointId(kind, id) from vectorStore for point ids

const runIndexJob = async (jobId) => {
  const client = await getQdrantClient();
  const collectionName = COLLECTION();
  const vectorSize = VECTOR_SIZE();

  // Create cancellation controller for this job
  const abortController = new AbortController();
  jobCancellation.set(jobId, abortController);

  const docs = await collectDocs();
  const total = docs.length;
  
  // Only initialize if job doesn't exist yet
  if (!indexJobs.has(jobId)) {
    indexJobs.set(jobId, { total, processed: 0, upserts: 0, errors: 0, startedAt: new Date(), finishedAt: null, done: false, cancelled: false });
  } else {
    // Update total if it was different
    const existing = indexJobs.get(jobId);
    if (existing.total !== total) {
      existing.total = total;
    }
  }

  console.log(`[runIndexJob] Starting job ${jobId} with ${docs.length} documents`);
  console.log(`[runIndexJob] Collection: ${collectionName}, Vector size: ${vectorSize}`);
  
  const BATCH = 64;
  let batchErrors = 0;
  
  for (let i = 0; i < docs.length; i += BATCH) {
    // Check for cancellation
    if (abortController.signal.aborted) {
      console.log(`[runIndexJob] Job ${jobId} cancelled at batch ${i}`);
      const st = indexJobs.get(jobId);
      if (st) {
        st.cancelled = true;
        st.done = true;
        st.finishedAt = new Date();
      }
      return indexJobs.get(jobId);
    }

    const slice = docs.slice(i, i + BATCH);
    const points = [];
    
    for (const d of slice) {
      try {
        const vector = await embedText(d.content);
        if (Array.isArray(vector) && vector.length === vectorSize) {
          const payload = { kind: d.kind, docId: d.id, preview: makePreview(d.content) };
          if (d.projectId) payload.projectId = d.projectId;
          if (d.meta && d.meta.sessionId) payload.sessionId = d.meta.sessionId;
          if (d.meta && typeof d.meta.chunkIndex === 'number') payload.chunkIndex = d.meta.chunkIndex;
          const rawId = String(d.id || '').split(':').pop();
          const uniqueRaw = (d.meta && typeof d.meta.chunkIndex === 'number') ? `${rawId}#${d.meta.chunkIndex}` : rawId;
          const pointId = toPointId(d.kind, uniqueRaw);
          points.push({ id: pointId, vector: Array.from(vector), payload });
        } else {
          batchErrors++;
          console.error(`[runIndexJob] Invalid vector for ${d.id}: length ${vector?.length}, expected ${vectorSize}`);
        }
      } catch (e) {
        batchErrors++;
        console.error('[qdrant.index job] embed failed', d.id, e?.message || e);
      }
      const st = indexJobs.get(jobId);
      if (st) {
        st.processed = (st.processed || 0) + 1;
      }
    }
    
    if (points.length > 0) {
      try {
        await client.upsert(collectionName, { points });
        const st = indexJobs.get(jobId);
        if (st) {
          st.upserts = (st.upserts || 0) + points.length;
        }
      } catch (e) {
        batchErrors += points.length;
        const body = e?.response?.data || e?.response || e?.message || e;
        console.error('[qdrant.index job] upsert failed', { batch: points.length, error: body });
      }
    }
    
    // Update error count for this batch
    const st = indexJobs.get(jobId);
    if (st) {
      st.errors = (st.errors || 0) + batchErrors;
    }
    batchErrors = 0; // Reset for next batch
  }
  
  const st = indexJobs.get(jobId);
  if (st) { 
    st.done = true; 
    st.finishedAt = new Date(); 
  }
  
  // Clean up cancellation controller
  jobCancellation.delete(jobId);
  
  return indexJobs.get(jobId);
};

Meteor.methods({
  async 'search.instant'(query, opts = {}) {
    check(query, String);
    const kinds = Array.isArray(opts?.kinds) && opts.kinds.length > 0
      ? opts.kinds.map(String)
      : ['project', 'task', 'note'];
    const limitPerKind = Math.max(1, Math.min(20, Number(opts?.limitPerKind) || 5));
    const q = String(query || '').trim();
    if (!q) return [];
    // Build a safe, case-insensitive regex for substring matching
    const escapeRegExp = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = escapeRegExp(q);
    const re = new RegExp(pattern, 'i');

    const results = [];

    const want = new Set(kinds);
    // Projects
    if (want.has('project')) {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const proj = await ProjectsCollection.find(
        { $or: [{ name: re }, { description: re }] },
        { fields: { name: 1, description: 1 }, limit: limitPerKind }
      ).fetchAsync();
      for (const p of proj) {
        results.push({
          score: '⚡',
          kind: 'project',
          projectId: p._id,
          projectName: p.name || null,
          id: `project:${p._id}`,
          text: makePreview(`${p.name || ''} ${p.description || ''}`),
        });
      }
    }

    // Tasks
    let taskProjectIds = new Set();
    let taskRows = [];
    if (want.has('task')) {
      const { TasksCollection } = await import('/imports/api/tasks/collections');
      taskRows = await TasksCollection.find(
        { title: re },
        { fields: { title: 1, projectId: 1, status: 1 }, limit: limitPerKind }
      ).fetchAsync();
      taskRows.forEach(t => { if (t.projectId) taskProjectIds.add(String(t.projectId)); });
    }

    // Notes
    let noteProjectIds = new Set();
    let noteRows = [];
    if (want.has('note')) {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      noteRows = await NotesCollection.find(
        { $or: [{ title: re }, { content: re }] },
        { fields: { title: 1, content: 1, projectId: 1 }, limit: limitPerKind }
      ).fetchAsync();
      noteRows.forEach(n => { if (n.projectId) noteProjectIds.add(String(n.projectId)); });
    }

    // Resolve project names for tasks/notes in batch
    const allProjIds = new Set([...taskProjectIds, ...noteProjectIds]);
    const projectNameById = new Map();
    if (allProjIds.size > 0) {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const list = await ProjectsCollection.find(
        { _id: { $in: Array.from(allProjIds) } },
        { fields: { name: 1 } }
      ).fetchAsync();
      for (const p of list) projectNameById.set(String(p._id), p.name || null);
    }

    // Format tasks
    if (taskRows.length > 0) {
      for (const t of taskRows) {
        const pid = t.projectId ? String(t.projectId) : null;
        results.push({
          score: '⚡',
          kind: 'task',
          projectId: pid,
          projectName: pid ? (projectNameById.get(pid) || null) : null,
          id: `task:${t._id}`,
          text: String(t.title || '').trim() || '(task)',
          status: t?.status || null,
        });
      }
    }

    // Format notes
    if (noteRows.length > 0) {
      for (const n of noteRows) {
        const pid = n.projectId ? String(n.projectId) : null;
        results.push({
          score: '⚡',
          kind: 'note',
          projectId: pid,
          projectName: pid ? (projectNameById.get(pid) || null) : null,
          id: `note:${n._id}`,
          text: makePreview(`${n.title || ''} ${n.content || ''}`),
        });
      }
    }

    return results;
  },
  async 'qdrant.health'() {
    const url = getQdrantUrl();
    if (!url) {
      return { url: null, collection: COLLECTION(), exists: false, disabled: true };
    }
    const client = await getQdrantClient();
    const name = COLLECTION();
    const expectedVectorSize = VECTOR_SIZE();
    const out = { url, collection: name, exists: false, vectorSize: expectedVectorSize };
    try {
      const info = await client.getCollection(name);
      if (info) {
        out.exists = true;
        const cfg = info.config?.params?.vectors;
        const actualVectorSize = cfg?.size ?? cfg?.config?.size;
        out.vectorSize = actualVectorSize;
        out.distance = cfg?.distance ?? cfg?.config?.distance;
        out.status = info?.status;
        
        // Check if vector dimensions are compatible
        if (actualVectorSize !== expectedVectorSize) {
          out.incompatible = true;
          out.expectedVectorSize = expectedVectorSize;
          out.message = `Collection exists but vector config differs (have size=${actualVectorSize}, distance=${out.distance}; expected size=${expectedVectorSize}, distance=Cosine)`;
        }
        
        // Attempt to fetch total number of points
        try {
          const cnt = await client.count(name, { exact: true });
          // js-client may return { result: { count } } or { count }
          out.count = (cnt?.result?.count ?? cnt?.count ?? 0);
        } catch (eCnt) {
          out.countError = eCnt?.message || String(eCnt);
        }
      }
    } catch (e) {
      out.error = e?.message || String(e);
    }
    return out;
  },
  async 'qdrant.lastIndexedRaw'(opts = {}) {
    const url = getQdrantUrl();
    if (!url) {
      return { disabled: true, items: [] };
    }
    const limit = Math.max(1, Math.min(100, Number(opts?.limit) || 10));
    const client = await getQdrantClient();
    // Use scroll with filter on payload.indexedAtMs (if present) sorted by decreasing timestamp
    // Qdrant scroll does not support sort, so we fetch a page and sort client-side.
    const scrollRes = await client.scroll(COLLECTION(), {
      filter: { must: [{ key: 'indexedAtMs', range: { gte: 0 } }] },
      with_payload: true,
      with_vector: false,
      limit: Math.max(limit, 64)
    });
    const normalizeScrollPoints = (res) => {
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.result)) return res.result;
      if (res && Array.isArray(res.points)) return res.points;
      if (res && res.result && Array.isArray(res.result.points)) return res.result.points;
      return [];
    };
    const points = normalizeScrollPoints(scrollRes);
    const items = points.map(p => ({
      id: p?.id,
      score: p?.score,
      payload: p?.payload || {}
    }))
    .filter(x => x && x.payload)
    .sort((a, b) => (Number(b.payload?.indexedAtMs || 0) - Number(a.payload?.indexedAtMs || 0)))
    .slice(0, limit);
    return { disabled: false, items };
  },
  async 'qdrant.indexAll'() { // legacy synchronous path
    const jobId = String(Date.now());
    await runIndexJob(jobId);
    return indexJobs.get(jobId);
  },
  async 'qdrant.indexStart'() {
    const jobId = String(Date.now());
    // Precompute docs to know total count quickly
    const docs = await collectDocs();
    indexJobs.set(jobId, { total: docs.length, processed: 0, upserts: 0, errors: 0, startedAt: new Date(), finishedAt: null, done: false });
    // Run async without awaiting
    setTimeout(async () => {
      try {
        const client = await getQdrantClient();
        const collectionName = COLLECTION();
        const vectorSize = VECTOR_SIZE();
        const distance = DISTANCE();
        
        console.log(`[qdrant.indexStart] Creating collection: ${collectionName} (size: ${vectorSize}, distance: ${distance})`);
        
        // Check if collection exists and has correct dimensions
        try {
          const existingInfo = await client.getCollection(collectionName);
          const existingSize = existingInfo.config?.params?.vectors?.size || existingInfo.config?.vectors?.size;
          if (existingSize === vectorSize) {
            console.log(`[qdrant.indexStart] Collection ${collectionName} exists with correct dimensions, clearing it`);
            // Clear existing points but keep collection
            await client.delete(collectionName, { filter: { must: [] } });
          } else {
            console.log(`[qdrant.indexStart] Collection ${collectionName} has wrong dimensions (${existingSize} vs ${vectorSize}), recreating`);
            await client.deleteCollection(collectionName);
            await client.createCollection(collectionName, { vectors: { size: vectorSize, distance } });
          }
        } catch {
          // Collection doesn't exist, create it
          console.log(`[qdrant.indexStart] Collection ${collectionName} doesn't exist, creating it`);
          await client.createCollection(collectionName, { vectors: { size: vectorSize, distance } });
        }
        console.log(`[qdrant.indexStart] Collection ${collectionName} ready`);
      } catch (e) {
        console.error('[qdrant.indexStart] drop+create failed', e);
      }
      runIndexJob(jobId).catch(e => { const st = indexJobs.get(jobId); if (st) { st.done = true; st.error = e?.message || String(e); st.finishedAt = new Date(); } });
    }, 0);
    return { jobId, total: docs.length };
  },
  async 'qdrant.indexKindStart'(kind) {
    check(kind, String);
    const allowed = new Set(['project', 'task', 'note', 'session', 'line', 'alarm', 'link', 'userlog']);
    if (!allowed.has(kind)) {
      throw new Meteor.Error('invalid-kind', `Unsupported kind: ${kind}`);
    }
    const jobId = `kind:${kind}:${Date.now()}`;
    const docs = await collectDocsByKind(kind);
    indexJobs.set(jobId, { total: docs.length, processed: 0, upserts: 0, errors: 0, startedAt: new Date(), finishedAt: null, done: false });
    setTimeout(async () => {
      try {
        // Clear existing points for this kind
        await deleteByKind(kind);
      } catch (e) {
        console.error('[qdrant.indexKindStart] deleteByKind failed', kind, e);
      }
      const client = await getQdrantClient();
      const vectorSize = VECTOR_SIZE();
      const BATCH = 64;
      for (let i = 0; i < docs.length; i += BATCH) {
        const slice = docs.slice(i, i + BATCH);
        const points = [];
        for (const d of slice) {
          try {
            const vector = await embedText(d.content);
            if (Array.isArray(vector) && vector.length === vectorSize) {
              const payload = { kind: d.kind, docId: d.id, preview: makePreview(d.content) };
              if (d.projectId) payload.projectId = d.projectId;
              if (d.meta && d.meta.sessionId) payload.sessionId = d.meta.sessionId;
              if (d.meta && typeof d.meta.chunkIndex === 'number') payload.chunkIndex = d.meta.chunkIndex;
              const rawId = String(d.id || '').split(':').pop();
              const uniqueRaw = (d.meta && typeof d.meta.chunkIndex === 'number') ? `${rawId}#${d.meta.chunkIndex}` : rawId;
              const pointId = toPointId(d.kind, uniqueRaw);
              points.push({ id: pointId, vector: Array.from(vector), payload });
            }
          } catch (e) {
            const st = indexJobs.get(jobId);
            if (st) st.errors += 1;
            console.error('[qdrant.indexKind job] embed failed', d.id, e?.message || e);
          }
          const st = indexJobs.get(jobId);
          if (st) st.processed += 1;
        }
        if (points.length > 0) {
          try {
            await client.upsert(COLLECTION(), { points });
            const st = indexJobs.get(jobId);
            st?.upserts && (st.upserts += points.length);
          } catch (e) {
            const st = indexJobs.get(jobId);
            st?.errors && (st.errors += points.length);
            const body = e?.response?.data || e?.response || e?.message || e;
            console.error('[qdrant.indexKind job] upsert failed', { batch: points.length, sample: points[0] && { id: points[0].id, len: points[0].vector?.length, payload: points[0].payload }, error: body });
          }
        }
      }
      const st = indexJobs.get(jobId);
      if (st) { 
        st.done = true; 
        st.finishedAt = new Date(); 
      }
    }, 0);
    return { jobId, total: docs.length };
  },
  async 'qdrant.indexStatus'(jobId) {
    const st = indexJobs.get(String(jobId));
    return st || { total: 0, processed: 0, upserts: 0, errors: 0, done: true, cancelled: false };
  },

  async 'qdrant.cancelIndex'(jobId) {
    check(jobId, String);
    const controller = jobCancellation.get(jobId);
    if (controller) {
      controller.abort();
      const st = indexJobs.get(jobId);
      if (st) {
        st.cancelled = true;
        st.done = true;
        st.finishedAt = new Date();
      }
      jobCancellation.delete(jobId);
      return { cancelled: true };
    }
    return { cancelled: false, reason: 'Job not found or already finished' };
  },
  async 'qdrant.indexKind'(kind) {
    check(kind, String);
    const allowed = new Set(['project', 'task', 'note', 'session', 'line', 'alarm', 'link', 'userlog']);
    if (!allowed.has(kind)) {
      throw new Meteor.Error('invalid-kind', `Unsupported kind: ${kind}`);
    }
    // Clear existing points for this kind
    await deleteByKind(kind);
    // Index documents for this kind only
    let processed = 0;
    if (kind === 'project') {
      const { ProjectsCollection } = await import('/imports/api/projects/collections');
      const items = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'project', id: it._id, text: `${it.name || ''} ${it.description || ''}`, projectId: it._id }); processed += 1; }
    } else if (kind === 'task') {
      const { TasksCollection } = await import('/imports/api/tasks/collections');
      const items = await TasksCollection.find({}, { fields: { title: 1, notes: 1, projectId: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'task', id: it._id, text: `${it.title || ''} ${it.notes || ''}`, projectId: it.projectId || null }); processed += 1; }
    } else if (kind === 'note') {
      const { NotesCollection } = await import('/imports/api/notes/collections');
      const items = await NotesCollection.find({}, { fields: { title: 1, content: 1, projectId: 1 } }).fetchAsync();
      const { upsertDocChunks } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDocChunks({ kind: 'note', id: it._id, text: `${it.title || ''} ${it.content || ''}`, projectId: it.projectId || null }); processed += 1; }
    } else if (kind === 'session') {
      const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
      const items = await NoteSessionsCollection.find({}, { fields: { name: 1, aiSummary: 1, projectId: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'session', id: it._id, text: `${it.name || ''} ${it.aiSummary || ''}`, projectId: it.projectId || null }); processed += 1; }
    } else if (kind === 'line') {
      const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
      const items = await NoteLinesCollection.find({}, { fields: { content: 1, sessionId: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'line', id: it._id, text: it.content || '', sessionId: it.sessionId || null }); processed += 1; }
    } else if (kind === 'alarm') {
      // Alarms are not indexed in Qdrant - they are temporary notifications
      console.log('[qdrant.indexKind] Skipping alarm indexing - alarms are not searchable');
      return { processed: 0 };
    } else if (kind === 'link') {
      const { LinksCollection } = await import('/imports/api/links/collections');
      const items = await LinksCollection.find({}, { fields: { name: 1, url: 1, projectId: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'link', id: it._id, text: `${it.name || ''} ${it.url || ''}`, projectId: it.projectId || null }); processed += 1; }
    } else if (kind === 'userlog') {
      const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
      const items = await UserLogsCollection.find({}, { fields: { content: 1 } }).fetchAsync();
      const { upsertDoc } = await import('/imports/api/search/vectorStore.js');
      for (const it of items) { await upsertDoc({ kind: 'userlog', id: it._id, text: it.content || '' }); processed += 1; }
    }
    return { processed };
  },
  async 'panorama.search'(query, opts = {}) {
    check(query, String);
    const url = getQdrantUrl();
    if (!url) {
      // In local mode, fallback to instant search when Qdrant is unavailable
      const { getAIConfig } = require('/imports/api/_shared/config');
      const config = getAIConfig();
      if (config.mode === 'local') {
        console.log('[search] Qdrant unavailable in local mode, falling back to instant search');
        const instantResults = await Meteor.callAsync('search.instant', query, opts);
        return { 
          results: instantResults || [], 
          cachedVector: false, 
          cacheSize: 0, 
          fallback: true 
        };
      }
      return { results: [], cachedVector: false, cacheSize: 0, disabled: true };
    }
    const client = await getQdrantClient();
    const { vector, cached } = await getQueryVector(String(query || ''));
    const filter = opts && opts.projectId ? { must: [{ key: 'projectId', match: { value: opts.projectId } }] } : undefined;
    const res = await client.search(COLLECTION(), { vector, limit: 10, filter, with_payload: true });
    // Map payloads back to docs
    const items = Array.isArray(res) ? res : (res?.result || []);
    const fetchPreview = async (kind, rawId) => {
      const id = String(rawId || '').split(':').pop();
      switch (kind) {
        case 'project': {
          const { ProjectsCollection } = await import('/imports/api/projects/collections');
          const p = await ProjectsCollection.findOneAsync({ _id: id }, { fields: { name: 1, description: 1 } });
          if (!p) return null;
          const s = `${p.name || ''} ${p.description || ''}`.trim();
          return s || '(project)';
        }
        case 'task': {
          const { TasksCollection } = await import('/imports/api/tasks/collections');
          const t = await TasksCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
          return t?.title || '(task)';
        }
        case 'note': {
          const { NotesCollection } = await import('/imports/api/notes/collections');
          const n = await NotesCollection.findOneAsync({ _id: id }, { fields: { title: 1, content: 1 } });
          const s = `${n?.title || ''} ${n?.content || ''}`.trim();
          return s || '(note)';
        }
        case 'session': {
          const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
          const s = await NoteSessionsCollection.findOneAsync({ _id: id }, { fields: { name: 1, aiSummary: 1 } });
          const txt = `${s?.name || ''} ${s?.aiSummary || ''}`.trim();
          return txt || '(session)';
        }
        case 'line': {
          const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
          const l = await NoteLinesCollection.findOneAsync({ _id: id }, { fields: { content: 1 } });
          return l?.content || '(line)';
        }
        case 'alarm': {
          const { AlarmsCollection } = await import('/imports/api/alarms/collections');
          const a = await AlarmsCollection.findOneAsync({ _id: id }, { fields: { title: 1 } });
          return a?.title || '(alarm)';
        }
        case 'link': {
          const { LinksCollection } = await import('/imports/api/links/collections');
          const l = await LinksCollection.findOneAsync({ _id: id }, { fields: { name: 1, url: 1 } });
          const s = `${l?.name || ''} ${l?.url || ''}`.trim();
          return s || '(link)';
        }
        case 'userlog': {
          const { UserLogsCollection } = await import('/imports/api/userLogs/collections');
          const u = await UserLogsCollection.findOneAsync({ _id: id }, { fields: { content: 1 } });
          return (u?.content || '').trim() || '(userlog)';
        }
        default:
          return null;
      }
    };
    const out = await Promise.all(items.map(async (it) => {
      const p = it?.payload || {};
      const text = p.preview || (await fetchPreview(p.kind, p.docId));
      const norm = (s, max = 180) => {
        const t = String(s || '').replace(/\s+/g, ' ').trim();
        return t.length > max ? `${t.slice(0, max - 1)}…` : t;
      };
      let status = null;
      let projectName = null;
      let linkUrl = null;
      if (p.kind === 'task' && p.docId) {
        const id = String(p.docId).split(':').pop();
        const { TasksCollection } = await import('/imports/api/tasks/collections');
        const t = await TasksCollection.findOneAsync({ _id: id }, { fields: { status: 1 } });
        status = t?.status || null;
      }
      if (p.projectId) {
        const { ProjectsCollection } = await import('/imports/api/projects/collections');
        const proj = await ProjectsCollection.findOneAsync({ _id: p.projectId }, { fields: { name: 1 } });
        projectName = proj?.name || null;
      }
      if (p.kind === 'link' && p.docId) {
        const id = String(p.docId).split(':').pop();
        const { LinksCollection } = await import('/imports/api/links/collections');
        const l = await LinksCollection.findOneAsync({ _id: id }, { fields: { url: 1 } });
        linkUrl = l?.url || null;
      }
      return {
        score: it?.score,
        kind: p.kind,
        projectId: p.projectId || null,
        projectName,
        id: p.docId || null,
        sessionId: p.sessionId || null,
        text: norm(text),
        status,
        url: linkUrl
      };
    }));
    // Deduplicate logical documents (same id) by keeping the best score
    const bestById = new Map();
    for (const r of out) {
      const key = r && r.id ? String(r.id) : null;
      if (!key) { continue; }
      const score = Number(r.score);
      const prev = bestById.get(key);
      if (!prev || (Number.isFinite(score) && score > (Number(prev?.score) || -Infinity))) {
        bestById.set(key, r);
      }
    }
    const deduped = (bestById.size > 0 ? Array.from(bestById.values()) : out)
      .sort((a, b) => (Number(b?.score) || 0) - (Number(a?.score) || 0));
    return { results: deduped, cachedVector: !!cached, cacheSize: vectorCache.size };
  }
});


