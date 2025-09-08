import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getQdrantUrl } from '/imports/api/_shared/config';
import { ErrorsCollection } from '/imports/api/errors/collections';
import crypto from 'crypto';

const COLLECTION = () => String(Meteor.settings?.qdrantCollectionName || 'panorama');
const VECTOR_SIZE = () => Number(Meteor.settings?.qdrantVectorSize || 1536);
const DISTANCE = () => String(Meteor.settings?.qdrantDistance || 'Cosine');

const DEBUG = false; // set true to avoid external embedding calls during dev

let singletonClient = null;
const getQdrantClient = async () => {
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

const mockVectorFromText = (text) => {
  const size = VECTOR_SIZE();
  const s = String(text || '');
  let h1 = 2166136261, h2 = 16777619; // FNV-ish mix
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = (h1 * 16777619) >>> 0;
    h2 ^= (c << (i % 13)); h2 = (h2 * 1099511627) >>> 0;
  }
  const out = new Array(size);
  let x = h1 ^ h2;
  for (let i = 0; i < size; i += 1) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = ((x & 0xffff) / 65535) - 0.5;
  }
  return out;
};

export const embedText = async (text) => {
  if (DEBUG) return mockVectorFromText(text);
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

export const upsertDoc = async ({ kind, id, text, projectId = null, sessionId = null, extraPayload = {} }) => {
  const client = await getQdrantClient();
  try {
    const vector = await embedText(text);
    const payload = { kind, docId: `${kind}:${id}`, preview: makePreview(text), ...extraPayload };
    if (projectId) payload.projectId = projectId;
    if (sessionId) payload.sessionId = sessionId;
    const pointId = toPointId(kind, id);
    await client.upsert(COLLECTION(), { points: [{ id: pointId, vector: Array.from(vector), payload }] });
  } catch (e) {
    // Log and swallow to prevent data loss on primary writes
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
  } catch (_e) {
    // probably exists; ignore
  }
};


