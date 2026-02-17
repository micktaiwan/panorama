import { Meteor } from 'meteor/meteor';
import { getQdrantUrl, getAIConfigAsync, getOpenAiApiKeyAsync } from '/imports/api/_shared/config';
import { embed as llmEmbed } from '/imports/api/_shared/llmProxy';
import { ErrorsCollection } from '/imports/api/errors/collections';
import crypto from 'crypto';

export const COLLECTION = () => {
  const baseName = String(Meteor.settings?.qdrantCollectionName || 'panorama');
  
  const { getAIConfig } = require('/imports/api/_shared/config');
  const config = getAIConfig();
  
  // In remote mode, always use base collection name (no model suffix)
  if (config.mode === 'remote') {
    return baseName;
  }
  
  // In local/auto mode, use model-suffixed collection name
  const model = config.mode === 'local' ? config.local.embeddingModel : config.remote.embeddingModel;
  const collectionName = `${baseName}_${model.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return collectionName;
};
// Dynamic vector size based on current embedding model
export const VECTOR_SIZE = () => {
  // Default sizes for common models
  const modelSizes = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
    'nomic-embed-text': 768,
    'nomic-embed-text:latest': 768,
    'mxbai-embed-large': 1024,
    'all-MiniLM-L6-v2': 384,
    'all-minilm:l6-v2': 384
  };
  
  // Try to get from settings first
  const fromSettings = Meteor.settings?.qdrantVectorSize;
  if (fromSettings) return Number(fromSettings);
  
  // Try to get from current AI config
  const { getAIConfig } = require('/imports/api/_shared/config');
  const config = getAIConfig();
  const model = config.mode === 'local' ? config.local.embeddingModel : config.remote.embeddingModel;
  
  // Try exact match first
  if (modelSizes[model]) {
    return modelSizes[model];
  }
  
  // Try to match by base name (without version tag)
  const baseModel = model.split(':')[0];
  if (modelSizes[baseModel]) {
    return modelSizes[baseModel];
  }
  
  return 1536; // fallback to OpenAI default
};
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
  if (s.length <= max) return s;

  // Use Array.from to handle surrogate pairs correctly
  // This ensures we don't split in the middle of emoji or other multi-byte characters
  const chars = Array.from(s);
  if (chars.length <= max - 1) return s;

  return chars.slice(0, max - 1).join('') + '…';
};

export const isEmbeddingConfigured = async (userId) => {
  const config = await getAIConfigAsync(userId);
  if (config.mode === 'remote') {
    return !!(await getOpenAiApiKeyAsync(userId));
  }
  return true; // local (Ollama) doesn't need an API key
};

export const embedText = async (text, { userId } = {}) => {
  const normalizedText = String(text || '').trim();

  // If text is empty after normalization, return null to indicate no embedding needed
  if (!normalizedText) {
    return null;
  }

  // Skip if embedding provider is not configured for this user
  if (!(await isEmbeddingConfigured(userId))) {
    return null;
  }

  const result = await llmEmbed([normalizedText], { userId });
  const vec = result.vectors?.[0];

  if (!Array.isArray(vec)) {
    console.error('[embedText] Invalid embedding response:', {
      result,
      vectors: result.vectors,
      firstVector: vec,
      textLength: normalizedText.length
    });
    throw new Meteor.Error('embedding-invalid', `Invalid embedding response from LLM proxy. Got: ${typeof vec}, expected: Array`);
  }

  // Note: We don't validate vector length here anymore since different models have different dimensions
  // The VECTOR_SIZE() check should be done at the collection level or when upserting
  return vec;
};

let collectionEnsured = false;
const ensureCollectionIfNeeded = async () => {
  if (collectionEnsured) return;
  await ensureCollection();
  collectionEnsured = true;
};

export const upsertDoc = async ({ kind, id, text, projectId = null, sessionId = null, userId = null, extraPayload = {} }) => {
  if (!(await isEmbeddingConfigured(userId))) {
    return;
  }
  const client = await getQdrantClient();
  await ensureCollectionIfNeeded();
  const vector = await embedText(text, { userId });

  // If no vector was generated (empty text), skip indexing
  if (!vector) {
    console.log(`[upsertDoc] Skipping indexing for ${kind}:${id} - no content to embed`);
    return;
  }

  const nowMs = Date.now();
  const payload = { kind, docId: `${kind}:${id}`, preview: makePreview(text), indexedAt: new Date(nowMs).toISOString(), indexedAtMs: nowMs, ...extraPayload };
  if (projectId) payload.projectId = projectId;
  if (sessionId) payload.sessionId = sessionId;
  if (userId) payload.userId = userId;
  const pointId = toPointId(kind, id);
  await client.upsert(COLLECTION(), { points: [{ id: pointId, vector: Array.from(vector), payload }] });
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

// Delete all points for a given kind (e.g. 'task', 'project', 'note', 'userlog', ...)
export const deleteByKind = async (kind) => {
  const client = await getQdrantClient();
  await client.delete(COLLECTION(), { filter: { must: [{ key: 'kind', match: { value: String(kind) } }] } });
};

export const ensureCollection = async () => {
  const client = await getQdrantClient();
  const collectionName = COLLECTION();
  const vectorSize = VECTOR_SIZE();
  const distance = DISTANCE();
  
  try {
    // Check if collection already exists
    await client.getCollection(collectionName);
    console.log(`[qdrant] Collection '${collectionName}' already exists`);
  } catch {
    // Collection doesn't exist, create it
    try {
      await client.createCollection(collectionName, { vectors: { size: vectorSize, distance } });
      console.log(`[qdrant] Created collection '${collectionName}' (size=${vectorSize}, distance=${distance})`);
    } catch (createError) {
      if (createError?.data?.status?.error?.includes('already exists')) {
        console.log(`[qdrant] Collection '${collectionName}' was created by another process`);
      } else {
        throw createError;
      }
    }
  }
  // Ensure payload index on userId for filtered searches
  try {
    await client.createPayloadIndex(collectionName, { field_name: 'userId', field_schema: 'keyword' });
    console.log(`[qdrant] Payload index on 'userId' ensured for '${collectionName}'`);
  } catch (indexError) {
    // Index may already exist — ignore
    if (!indexError?.data?.status?.error?.includes('already exists')) {
      console.warn(`[qdrant] Could not create userId payload index: ${indexError?.message || indexError}`);
    }
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
export const upsertDocChunks = async ({ kind, id, text, projectId = null, sessionId = null, userId = null, extraPayload = {}, minChars = 800, maxChars = 1200, overlap = 150 }) => {
  if (!(await isEmbeddingConfigured(userId))) {
    return;
  }
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
      const vector = await embedText(chunk, { userId });
      
      // Skip chunks that couldn't be embedded (empty content)
      if (!vector) {
        console.log(`[upsertDocChunks] Skipping chunk ${i} for ${kind}:${id} - no content to embed`);
        continue;
      }
      
      const nowMs = Date.now();
      const payload = { kind, docId: `${kind}:${id}`, preview: makePreview(chunk), chunkIndex: i, indexedAt: new Date(nowMs).toISOString(), indexedAtMs: nowMs, ...extraPayload };
      if (projectId) payload.projectId = projectId;
      if (sessionId) payload.sessionId = sessionId;
      if (userId) payload.userId = userId;
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


