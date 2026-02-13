import crypto from 'crypto';
import { getQdrantUrl, getAIConfig } from './config.js';
import { embed as llmEmbed } from './llmProxy.js';

// Dynamic collection name based on mode
export function getCollectionName(): string {
  const baseName = process.env.QDRANT_COLLECTION || 'panoramix';
  const config = getAIConfig();

  if (config.mode === 'remote') return baseName;

  const model = config.local.embeddingModel;
  return `${baseName}_${model.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

// Dynamic vector size based on embedding model
const MODEL_SIZES: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'nomic-embed-text': 768,
  'nomic-embed-text:latest': 768,
  'mxbai-embed-large': 1024,
  'all-MiniLM-L6-v2': 384,
  'all-minilm:l6-v2': 384,
};

export function getVectorSize(): number {
  const fromEnv = process.env.QDRANT_VECTOR_SIZE;
  if (fromEnv) return Number(fromEnv);

  const config = getAIConfig();
  const model = config.mode === 'local' ? config.local.embeddingModel : config.remote.embeddingModel;

  if (MODEL_SIZES[model]) return MODEL_SIZES[model];

  const base = model.split(':')[0];
  if (MODEL_SIZES[base]) return MODEL_SIZES[base];

  return 1536; // fallback OpenAI default
}

// Qdrant HTTP client (no SDK dependency — use raw fetch)
function qdrantUrl(): string {
  const url = getQdrantUrl();
  if (!url) throw new Error('QDRANT_URL not configured');
  return url.replace(/\/$/, '');
}

async function qdrantRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${qdrantUrl()}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant ${method} ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

// Point ID from kind + id (deterministic SHA1 UUID)
export function toPointId(kind: string, id: string): string {
  const raw = `${kind}:${id}`;
  const hex = crypto.createHash('sha1').update(raw).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Text preview (emoji-safe)
export function makePreview(text: string, max = 180): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const chars = Array.from(s);
  if (chars.length <= max - 1) return s;
  return chars.slice(0, max - 1).join('') + '…';
}

// Embed a single text
export async function embedText(text: string): Promise<number[] | null> {
  const normalized = String(text || '').trim();
  if (!normalized) return null;

  const result = await llmEmbed([normalized]);
  const vec = result.vectors?.[0];

  if (!Array.isArray(vec)) {
    throw new Error(`Invalid embedding response: expected Array, got ${typeof vec}`);
  }

  return vec;
}

// Ensure collection exists
let collectionEnsured = false;

export async function ensureCollection(): Promise<void> {
  if (collectionEnsured) return;

  const name = getCollectionName();
  const size = getVectorSize();

  try {
    await qdrantRequest('GET', `/collections/${name}`);
    console.log(`[qdrant] Collection '${name}' exists`);
  } catch {
    try {
      await qdrantRequest('PUT', `/collections/${name}`, {
        vectors: { size, distance: 'Cosine' },
      });
      console.log(`[qdrant] Created collection '${name}' (size=${size})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already exists')) {
        console.log(`[qdrant] Collection '${name}' created by another process`);
      } else {
        throw err;
      }
    }
  }

  collectionEnsured = true;
}

// Upsert a single document
export async function upsertDoc(params: {
  kind: string;
  id: string;
  text: string;
  projectId?: string | null;
  sessionId?: string | null;
  extraPayload?: Record<string, unknown>;
}): Promise<void> {
  await ensureCollection();
  const vector = await embedText(params.text);

  if (!vector) {
    console.log(`[upsertDoc] Skipping ${params.kind}:${params.id} — no content`);
    return;
  }

  const nowMs = Date.now();
  const payload: Record<string, unknown> = {
    kind: params.kind,
    docId: `${params.kind}:${params.id}`,
    preview: makePreview(params.text),
    indexedAt: new Date(nowMs).toISOString(),
    indexedAtMs: nowMs,
    ...(params.extraPayload || {}),
  };
  if (params.projectId) payload.projectId = params.projectId;
  if (params.sessionId) payload.sessionId = params.sessionId;

  const pointId = toPointId(params.kind, params.id);

  await qdrantRequest('PUT', `/collections/${getCollectionName()}/points`, {
    points: [{ id: pointId, vector: Array.from(vector), payload }],
  });
}

// Delete a single document
export async function deleteDoc(kind: string, id: string): Promise<void> {
  const pointId = toPointId(kind, id);
  await qdrantRequest('POST', `/collections/${getCollectionName()}/points/delete`, {
    points: [pointId],
  });
}

// Delete all by projectId
export async function deleteByProjectId(projectId: string): Promise<void> {
  await qdrantRequest('POST', `/collections/${getCollectionName()}/points/delete`, {
    filter: { must: [{ key: 'projectId', match: { value: projectId } }] },
  });
}

// Delete all by kind
export async function deleteByKind(kind: string): Promise<void> {
  await qdrantRequest('POST', `/collections/${getCollectionName()}/points/delete`, {
    filter: { must: [{ key: 'kind', match: { value: kind } }] },
  });
}

// Delete all chunks for a logical document
export async function deleteByDocId(kind: string, id: string): Promise<void> {
  const docId = `${kind}:${id}`;
  await qdrantRequest('POST', `/collections/${getCollectionName()}/points/delete`, {
    filter: { must: [{ key: 'docId', match: { value: docId } }] },
  });
}

// Split text into chunks with overlap
export function splitIntoChunks(text: string, minChars = 800, maxChars = 1200, overlap = 150): string[] {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const rawParas = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const pieces: string[] = [];

  const splitLong = (s: string): string[] => {
    const out: string[] = [];
    let start = 0;
    while (start < s.length) {
      const end = Math.min(s.length, start + maxChars);
      out.push(s.slice(start, end));
      if (end >= s.length) break;
      start = Math.max(0, end - overlap);
    }
    return out;
  };

  for (const para of rawParas) {
    if (para.length <= maxChars) pieces.push(para);
    else splitLong(para).forEach(x => pieces.push(x));
  }

  const chunks: string[] = [];
  let buf = '';

  for (const p of pieces) {
    if (!buf) { buf = p; continue; }
    const nextLen = buf.length + 1 + p.length;
    if (nextLen <= maxChars) {
      buf = `${buf}\n${p}`;
    } else {
      chunks.push(buf);
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      buf = tail ? `${tail}\n${p}` : p;
      if (buf.length > maxChars) {
        splitLong(buf).forEach(x => chunks.push(x));
        buf = '';
      }
    }
  }
  if (buf) chunks.push(buf);

  // Merge small trailing chunk
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < Math.min(400, minChars)) {
    const last = chunks.pop()!;
    const prev = chunks.pop()!;
    const merged = `${prev}\n${last}`;
    if (merged.length <= maxChars) chunks.push(merged);
    else { chunks.push(prev); chunks.push(last); }
  }

  return chunks;
}

// Upsert multiple chunks for one document
export async function upsertDocChunks(params: {
  kind: string;
  id: string;
  text: string;
  projectId?: string | null;
  sessionId?: string | null;
  extraPayload?: Record<string, unknown>;
}): Promise<void> {
  await ensureCollection();
  const normalized = String(params.text || '').trim();
  if (!normalized) return;

  const chunks = splitIntoChunks(normalized);
  const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = await embedText(chunk);
    if (!vector) continue;

    const nowMs = Date.now();
    const payload: Record<string, unknown> = {
      kind: params.kind,
      docId: `${params.kind}:${params.id}`,
      preview: makePreview(chunk),
      chunkIndex: i,
      indexedAt: new Date(nowMs).toISOString(),
      indexedAtMs: nowMs,
      ...(params.extraPayload || {}),
    };
    if (params.projectId) payload.projectId = params.projectId;
    if (params.sessionId) payload.sessionId = params.sessionId;

    points.push({
      id: toPointId(params.kind, `${params.id}#${i}`),
      vector: Array.from(vector),
      payload,
    });
  }

  if (points.length === 0) {
    throw new Error('No chunks could be embedded');
  }

  await qdrantRequest('PUT', `/collections/${getCollectionName()}/points`, { points });
}

// Semantic search
export async function search(query: string, options: {
  limit?: number;
  kind?: string;
  projectId?: string;
} = {}): Promise<Array<{ score: number; payload: Record<string, unknown> }>> {
  await ensureCollection();

  const vector = await embedText(query);
  if (!vector) return [];

  const filter: { must: Array<Record<string, unknown>> } = { must: [] };
  if (options.kind) {
    filter.must.push({ key: 'kind', match: { value: options.kind } });
  }
  if (options.projectId) {
    filter.must.push({ key: 'projectId', match: { value: options.projectId } });
  }

  const body: Record<string, unknown> = {
    vector,
    limit: options.limit || 20,
    with_payload: true,
  };

  if (filter.must.length > 0) {
    body.filter = filter;
  }

  const result = await qdrantRequest('POST', `/collections/${getCollectionName()}/points/search`, body) as {
    result: Array<{ score: number; payload: Record<string, unknown> }>;
  };

  return result.result || [];
}

// Get collection info (for health checks)
export async function getCollectionInfo(): Promise<unknown> {
  const name = getCollectionName();
  return qdrantRequest('GET', `/collections/${name}`);
}
