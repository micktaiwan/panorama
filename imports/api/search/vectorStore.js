import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getQdrantUrl } from '/imports/api/_shared/config';
import { ErrorsCollection } from '/imports/api/errors/collections';
import crypto from 'crypto';

export const COLLECTION = () => String(Meteor.settings?.qdrantCollectionName || 'panorama');
export const VECTOR_SIZE = () => Number(Meteor.settings?.qdrantVectorSize || 1536);
export const DISTANCE = () => String(Meteor.settings?.qdrantDistance || 'Cosine');

let singletonClient = null;
export const getQdrantClient = async () => {
  if (singletonClient) return singletonClient;
  const url = getQdrantUrl();
  if (!url) throw new Meteor.Error('config-missing', 'qdrantUrl missing in settings');
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  singletonClient = new QdrantClient({ url });
  return singletonClient;
};

export const toPointId = (kind, id) => {
  const raw = `${String(kind)}:${String(id)}`;
  const hex = crypto.createHash('sha1').update(raw).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
};

export const makePreview = (text, max = 180) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export const embedText = async (text) => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
  const { default: fetch } = await import('node-fetch');
  const payload = { model: 'text-embedding-3-small', input: String(text || '') };
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Meteor.Error('openai-failed', txt);
    try {
      await ErrorsCollection.insertAsync({
        kind: 'vectorization',
        message: 'OpenAI embeddings HTTP error',
        context: { status: res.status, statusText: res.statusText, payloadModel: payload.model },
        createdAt: new Date(),
      });
    } catch (e) { console.error('[errors][log] failed to record openai-failed', e); }
    throw err;
  }
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== VECTOR_SIZE()) {
    const err = new Meteor.Error('openai-invalid', `Invalid embedding vector length ${Array.isArray(vec) ? vec.length : typeof vec}`);
    try {
      await ErrorsCollection.insertAsync({
        kind: 'vectorization',
        message: 'Invalid embedding vector length',
        context: { length: Array.isArray(vec) ? vec.length : null },
        createdAt: new Date(),
      });
    } catch (e) { console.error('[errors][log] failed to record openai-invalid', e); }
    throw err;
  }
  return vec;
};

let collectionEnsured = false;
const ensureCollectionIfNeeded = async () => {
  if (collectionEnsured) return;
  await ensureCollection();
  collectionEnsured = true;
};

export const upsertDoc = async ({ kind, id, text, projectId = null, sessionId = null, extraPayload = {} }) => {
  const client = await getQdrantClient();
  try {
    await ensureCollectionIfNeeded();
    const vector = await embedText(text);
    const payload = { kind, docId: `${kind}:${id}`, preview: makePreview(text), ...extraPayload };
    if (projectId) payload.projectId = projectId;
    if (sessionId) payload.sessionId = sessionId;
    const pointId = toPointId(kind, id);
    await client.upsert(COLLECTION(), { points: [{ id: pointId, vector: Array.from(vector), payload }] });
  } catch (e) {
    // Log and rethrow to let callers decide how to handle indexing failures
    try {
      await ErrorsCollection.insertAsync({
        kind: 'vectorization',
        message: e?.message || String(e),
        context: { kind, id, hasProjectId: !!projectId, hasSessionId: !!sessionId },
        createdAt: new Date(),
      });
    } catch (_e) { console.error('[errors][log] failed to record vectorization error', _e); }
    throw e;
  }
};

export const deleteDoc = async (kind, id) => {
  const client = await getQdrantClient();
  const pointId = toPointId(kind, id);
  await client.delete(COLLECTION(), { points: [pointId] });
};

export const deleteByProjectId = async (projectId) => {
  const client = await getQdrantClient();
  await client.delete(COLLECTION(), { filter: { must: [{ key: 'projectId', match: { value: projectId } }] } });
};

export const deleteBySessionId = async (sessionId) => {
  const client = await getQdrantClient();
  await client.delete(COLLECTION(), { filter: { must: [{ key: 'sessionId', match: { value: sessionId } }] } });
};

export const ensureCollection = async () => {
  const client = await getQdrantClient();
  try {
    await client.createCollection(COLLECTION(), { vectors: { size: VECTOR_SIZE(), distance: DISTANCE() } });
  } catch (e) {
    const status = e && (e.response?.status || e.status);
    const msg = e && (e.response?.data || e.message || String(e));
    const isExists = (status === 409) || (String(msg || '').toLowerCase().includes('exist'));
    if (isExists) return; // collection already exists; benign
    throw e;
  }
};

// Split text into paragraph-based chunks with overlap
export const splitIntoChunks = (text, minChars = 800, maxChars = 1200, overlap = 150) => {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const rawParas = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const pieces = [];
  // Helper: split a long string into segments <= maxChars with overlap
  const splitLong = (s) => {
    const out = [];
    let start = 0;
    while (start < s.length) {
      const end = Math.min(s.length, start + maxChars);
      out.push(s.slice(start, end));
      if (end >= s.length) break;
      start = Math.max(0, end - overlap);
    }
    return out;
  };
  // First, ensure paragraphs themselves are not oversized
  for (const para of rawParas) {
    if (para.length <= maxChars) pieces.push(para);
    else splitLong(para).forEach(x => pieces.push(x));
  }
  // Pack paragraphs into chunks aiming for min..max
  const chunks = [];
  let buf = '';
  for (const p of pieces) {
    if (!buf) { buf = p; continue; }
    const nextLen = buf.length + 1 + p.length;
    if (nextLen <= maxChars) {
      buf = `${buf}\n${p}`;
    } else {
      // finalize current buffer
      chunks.push(buf);
      // start next; consider overlap from end of buf
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      buf = tail ? `${tail}\n${p}` : p;
      if (buf.length > maxChars) {
        // if still too long (rare), split
        splitLong(buf).forEach(x => chunks.push(x));
        buf = '';
      }
    }
  }
  if (buf) chunks.push(buf);
  // Merge very small trailing chunk back if possible
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < Math.min(400, minChars)) {
    const last = chunks.pop();
    const prev = chunks.pop();
    const merged = `${prev}\n${last}`;
    if (merged.length <= maxChars) chunks.push(merged);
    else { chunks.push(prev); chunks.push(last); }
  }
  return chunks;
};

// Upsert multiple chunks for one logical document
export const upsertDocChunks = async ({ kind, id, text, projectId = null, sessionId = null, extraPayload = {}, minChars = 800, maxChars = 1200, overlap = 150 }) => {
  const client = await getQdrantClient();
  await ensureCollectionIfNeeded();
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    // Nothing to index for empty content
    return;
  }
  const chunks = splitIntoChunks(normalizedText, minChars, maxChars, overlap);
  const points = [];
  for (let i = 0; i < chunks.length; i += 1) {
    try {
      const chunk = chunks[i];
      const vector = await embedText(chunk);
      const payload = { kind, docId: `${kind}:${id}`, preview: makePreview(chunk), chunkIndex: i, ...extraPayload };
      if (projectId) payload.projectId = projectId;
      if (sessionId) payload.sessionId = sessionId;
      const pointId = toPointId(kind, `${id}#${i}`);
      points.push({ id: pointId, vector: Array.from(vector), payload });
    } catch (e) {
      try {
        await ErrorsCollection.insertAsync({
          kind: 'vectorization',
          message: e?.message || String(e),
          context: { kind, id, chunkIndex: i, hasProjectId: !!projectId, hasSessionId: !!sessionId },
          createdAt: new Date(),
        });
      } catch (_e) { console.error('[errors][log] failed to record chunk vectorization error', _e); }
    }
  }
  if (points.length === 0) {
    throw new Meteor.Error('vectorization-failed', 'No chunks could be embedded');
  }
  await client.upsert(COLLECTION(), { points });
};

// Delete all points for a logical document by payload.docId
export const deleteByDocId = async (kind, id) => {
  const client = await getQdrantClient();
  const docId = `${kind}:${id}`;
  await client.delete(COLLECTION(), { filter: { must: [{ key: 'docId', match: { value: docId } }] } });
};


