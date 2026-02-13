/**
 * Reindex all documents in Qdrant vector store
 *
 * After a data migration, run this to recompute all embeddings.
 *
 * Usage:
 *   npx tsx scripts/reindex-qdrant.ts [--collection projects|tasks|notes|links|userlogs]
 *
 * Prerequisites:
 *   - Panoramix backend .env configured (MONGODB_URI, QDRANT_URL, AI_MODE, etc.)
 *   - Qdrant and embedding provider running
 */

import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

// Dynamic import of backend services (compiled)
async function main() {
  const args = process.argv.slice(2);
  const onlyCollection = args.includes('--collection') ? args[args.indexOf('--collection') + 1] : null;

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/panoramix';
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';

  console.log(`MongoDB: ${mongoUri}`);
  console.log(`Qdrant: ${qdrantUrl}`);
  console.log('');

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db!;

  // Check Qdrant health
  try {
    const resp = await fetch(`${qdrantUrl}/collections`);
    if (!resp.ok) throw new Error(`Qdrant ${resp.status}`);
    console.log('Qdrant: OK');
  } catch (err: any) {
    console.error(`Qdrant inaccessible: ${err.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Ensure collection exists
  const collectionName = 'panoramix';
  try {
    const resp = await fetch(`${qdrantUrl}/collections/${collectionName}`);
    if (resp.status === 404) {
      console.log(`Creating Qdrant collection "${collectionName}"...`);
      await fetch(`${qdrantUrl}/collections/${collectionName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: { size: 768, distance: 'Cosine' },
        }),
      });
    }
  } catch (err: any) {
    console.error(`Qdrant collection error: ${err.message}`);
  }

  const collections = [
    { name: 'projects', kind: 'project', textFn: (d: any) => `${d.name} ${d.description || ''}` },
    { name: 'tasks', kind: 'task', textFn: (d: any) => `${d.title} ${d.description || ''}` },
    { name: 'notes', kind: 'note', textFn: (d: any) => `${d.title} ${d.content || ''}` },
    { name: 'links', kind: 'link', textFn: (d: any) => `${d.name} ${d.url}` },
    { name: 'userlogs', kind: 'userlog', textFn: (d: any) => d.content || '' },
  ];

  for (const coll of collections) {
    if (onlyCollection && coll.name !== onlyCollection) continue;

    console.log(`\n--- Indexing ${coll.name} ---`);
    const docs = await db.collection(coll.name).find().toArray();
    console.log(`  Found ${docs.length} documents`);

    let indexed = 0;
    let errors = 0;

    for (const doc of docs) {
      const text = coll.textFn(doc).trim();
      if (!text || text.length < 5) continue;

      try {
        // Embed text
        const embedding = await embedText(text);
        if (!embedding) {
          errors++;
          continue;
        }

        // Upsert to Qdrant
        const pointId = hashToPointId(`${coll.kind}:${doc._id}`);
        await fetch(`${qdrantUrl}/collections/${collectionName}/points`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: [{
              id: pointId,
              vector: embedding,
              payload: {
                kind: coll.kind,
                docId: doc._id.toString(),
                userId: doc.userId?.toString(),
                name: doc.name || doc.title || '',
                preview: text.slice(0, 300),
              },
            }],
          }),
        });

        indexed++;
        if (indexed % 50 === 0) {
          console.log(`  Indexed ${indexed}/${docs.length}...`);
        }
      } catch (err: any) {
        errors++;
        if (errors <= 5) console.error(`  Error: ${err.message}`);
      }
    }

    console.log(`  Done: ${indexed} indexed, ${errors} errors`);
  }

  await mongoose.disconnect();
  console.log('\nReindexing complete!');
}

// --- Embedding ---

async function embedText(text: string): Promise<number[] | null> {
  const aiMode = process.env.AI_MODE || 'local';

  if (aiMode === 'local' || aiMode === 'ollama') {
    const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text:latest';

    try {
      const resp = await fetch(`${host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      return data.embeddings?.[0] || null;
    } catch {
      return null;
    }
  }

  if (aiMode === 'remote' || aiMode === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    try {
      const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as any;
      return data.data?.[0]?.embedding || null;
    } catch {
      return null;
    }
  }

  return null;
}

// --- Hash helper (deterministic point ID for Qdrant) ---

function hashToPointId(input: string): string {
  // Use a simple hash that produces a valid Qdrant UUID-like string
  const { createHash } = require('crypto');
  const hash = createHash('sha1').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
