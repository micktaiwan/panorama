import { Meteor } from 'meteor/meteor';
import { getQdrantUrl } from '/imports/api/_shared/config';
import { check } from 'meteor/check';
import { getQdrantClient, COLLECTION, VECTOR_SIZE, DISTANCE, embedText, makePreview, toPointId, splitIntoChunks } from './vectorStore';

// primitives are imported from './vectorStore'

// In-memory LRU cache for query vectors
const VECTOR_CACHE_MAX = 2000;
const vectorCache = new Map(); // key -> { vec: number[], at: number }
const inFlightVectors = new Map(); // key -> Promise<number[]>
const normalizeQuery = (q) => {
  const base = String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();
  try {
    return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    return base; // environments without normalize
  }
};
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
const indexJobs = new Map(); // jobId -> { total, processed, upserts, errors, startedAt, finishedAt, done }

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
  const { AlarmsCollection } = await import('/imports/api/alarms/collections');
  const { LinksCollection } = await import('/imports/api/links/collections');

  const projects = await ProjectsCollection.find({}, { fields: { name: 1, description: 1 } }).fetchAsync();
  projects.forEach(p => pushDoc(p._id, p._id, 'project', `${p.name || ''} ${p.description || ''}`));
  const tasks = await TasksCollection.find({}, { fields: { title: 1, projectId: 1 } }).fetchAsync();
  tasks.forEach(t => pushDoc(t._id, t.projectId, 'task', t.title || ''));
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
  const alarms = await AlarmsCollection.find({}, { fields: { title: 1 } }).fetchAsync();
  alarms.forEach(a => pushDoc(a._id, null, 'alarm', a.title || ''));
  const links = await LinksCollection.find({}, { fields: { name: 1, url: 1, projectId: 1 } }).fetchAsync();
  links.forEach(l => pushDoc(l._id, l.projectId, 'link', `${l.name || ''} ${l.url || ''}`));
  return docs;
};

// use toPointId(kind, id) from vectorStore for point ids

const runIndexJob = async (jobId) => {
  const client = await getQdrantClient();
  const collectionName = COLLECTION();
  const vectorSize = VECTOR_SIZE();

  const docs = await collectDocs();
  const total = docs.length;
  indexJobs.set(jobId, { total, processed: 0, upserts: 0, errors: 0, startedAt: new Date(), finishedAt: null, done: false });

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
        console.error('[qdrant.index job] embed failed', d.id, e?.message || e);
      }
      const st = indexJobs.get(jobId);
      if (st) st.processed += 1;
    }
    if (points.length > 0) {
      try {
        await client.upsert(collectionName, { points });
        const st = indexJobs.get(jobId);
        if (st) st.upserts += points.length;
      } catch (e) {
        const st = indexJobs.get(jobId);
        if (st) st.errors += points.length;
        const body = e?.response?.data || e?.response || e?.message || e;
        console.error('[qdrant.index job] upsert failed', { batch: points.length, sample: points[0] && { id: points[0].id, len: points[0].vector?.length, payload: points[0].payload }, error: body });
      }
    }
  }
  const st = indexJobs.get(jobId);
  if (st) { st.done = true; st.finishedAt = new Date(); }
  return indexJobs.get(jobId);
};

Meteor.methods({
  async 'qdrant.health'() {
    const url = getQdrantUrl();
    if (!url) throw new Meteor.Error('config-missing', 'qdrantUrl missing in settings');
    const client = await getQdrantClient();
    const name = COLLECTION();
    const out = { url, collection: name, exists: false };
    try {
      const info = await client.getCollection(name);
      if (info) {
        out.exists = true;
        const cfg = info.config?.params?.vectors;
        out.vectorSize = cfg?.size ?? cfg?.config?.size;
        out.distance = cfg?.distance ?? cfg?.config?.distance;
        out.status = info?.status;
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
        // Drop and recreate collection to ensure a clean state
        try {
          await client.deleteCollection(COLLECTION());
        } catch (e) {
          // if it doesn't exist, ignore
        }
        await client.createCollection(COLLECTION(), { vectors: { size: VECTOR_SIZE(), distance: DISTANCE() } });
      } catch (e) {
        console.error('[qdrant.indexStart] drop+create failed', e);
      }
      runIndexJob(jobId).catch(e => { const st = indexJobs.get(jobId); if (st) { st.done = true; st.error = e?.message || String(e); st.finishedAt = new Date(); } });
    }, 0);
    return { jobId, total: docs.length };
  },
  async 'qdrant.indexStatus'(jobId) {
    const st = indexJobs.get(String(jobId));
    return st || { total: 0, processed: 0, upserts: 0, errors: 0, done: true };
  },
  async 'panorama.search'(query, opts = {}) {
    check(query, String);
    const client = await getQdrantClient();
    const { vector, cached } = await getQueryVector(String(query || ''));
    const filter = opts && opts.projectId ? { must: [{ key: 'projectId', match: { value: opts.projectId } }] } : undefined;
    const res = await client.search(COLLECTION(), { vector, limit: 10, filter, with_payload: true });
    // Map payloads back to docs
    const items = Array.isArray(res) ? res : (res?.result || []);
    const fetchPreview = async (kind, rawId) => {
      try {
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
          default:
            return null;
        }
      } catch (e) {
        console.error('[panorama.search] preview fetch failed', { kind, rawId }, e);
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
      if (p.kind === 'task' && p.docId) {
        try {
          const id = String(p.docId).split(':').pop();
          const { TasksCollection } = await import('/imports/api/tasks/collections');
          const t = await TasksCollection.findOneAsync({ _id: id }, { fields: { status: 1 } });
          status = t?.status || null;
        } catch (_e) {
          status = null;
        }
      }
      if (p.projectId) {
        try {
          const { ProjectsCollection } = await import('/imports/api/projects/collections');
          const proj = await ProjectsCollection.findOneAsync({ _id: p.projectId }, { fields: { name: 1 } });
          projectName = proj?.name || null;
        } catch (_e) {
          projectName = null;
        }
      }
      return {
        score: it?.score,
        kind: p.kind,
        projectId: p.projectId || null,
        projectName,
        id: p.docId || null,
        sessionId: p.sessionId || null,
        text: norm(text),
        status
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


