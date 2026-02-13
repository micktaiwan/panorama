/**
 * Panorama → Panoramix Migration Script
 *
 * Reads a Panorama NDJSON.gz export and imports into Panoramix MongoDB.
 * - Maps Meteor string _id to MongoDB ObjectId (maintains a mapping table)
 * - Reassigns userId to the target Panoramix user
 * - Preserves all inter-document references (projectId, sessionId, etc.)
 *
 * Usage:
 *   npx tsx scripts/migrate-panorama.ts <export.ndjson.gz> <target-username>
 *
 * Prerequisites:
 *   - Panoramix backend must be running (or MongoDB accessible)
 *   - Target user must exist in Panoramix
 */

import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load backend .env
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

// --- Collection name mapping: Panorama export name → Panoramix model name ---
const COLLECTION_MAP: Record<string, string> = {
  projects: 'projects',
  tasks: 'tasks',
  notes: 'notes',
  note_sessions: 'notesessions',
  note_lines: 'notelines',
  alarms: 'alarms',
  links: 'links',
  teams: 'teams',
  people: 'people',
  situations: 'situations',
  situation_actors: 'situationactors',
  situation_notes: 'situationnotes',
  situation_questions: 'situationquestions',
  situation_summaries: 'situationsummaries',
  budgetLines: 'budgetlines',
  userLogs: 'userlogs',
};

// Fields that contain references to other document IDs
const REF_FIELDS: Record<string, string[]> = {
  tasks: ['projectId'],
  notes: ['projectId'],
  note_sessions: ['projectId'],
  note_lines: ['sessionId'],
  links: ['projectId'],
  files: ['projectId'],
  situations: [],
  situation_actors: ['situationId', 'personId'],
  situation_notes: ['situationId', 'actorId'],
  situation_questions: ['situationId', 'actorId'],
  situation_summaries: ['situationId'],
  people: ['teamId'],
  budgetLines: ['projectId'],
};

// --- ID mapping ---
const idMap = new Map<string, mongoose.Types.ObjectId>();

function mapId(oldId: string | null | undefined): mongoose.Types.ObjectId | null {
  if (!oldId) return null;
  if (!idMap.has(oldId)) {
    idMap.set(oldId, new mongoose.Types.ObjectId());
  }
  return idMap.get(oldId)!;
}

// --- Stats ---
const stats = {
  total: 0,
  imported: 0,
  skipped: 0,
  errors: 0,
  byCollection: {} as Record<string, number>,
};

async function main() {
  const [, , archivePath, targetUsername] = process.argv;

  if (!archivePath || !targetUsername) {
    console.error('Usage: npx tsx scripts/migrate-panorama.ts <export.ndjson.gz> <target-username>');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/panoramix';
  console.log(`Connecting to ${mongoUri}...`);
  await mongoose.connect(mongoUri);

  // Find target user
  const db = mongoose.connection.db!;
  const user = await db.collection('users').findOne({ username: targetUsername });
  if (!user) {
    console.error(`User "${targetUsername}" not found in Panoramix. Create the account first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const targetUserId = user._id;
  console.log(`Target user: ${targetUsername} (${targetUserId})`);
  console.log(`Reading: ${archivePath}`);
  console.log('');

  // Read and parse NDJSON.gz
  const gunzip = createGunzip();
  const stream = createReadStream(archivePath).pipe(gunzip);
  const rl = createInterface({ input: stream });

  let currentCollection: string | null = null;
  const batch: any[] = [];
  const BATCH_SIZE = 100;

  for await (const line of rl) {
    stats.total++;

    try {
      const entry = JSON.parse(line);

      // Begin/end markers
      if (entry.type === 'begin') {
        currentCollection = entry.collection;
        console.log(`  [${currentCollection}] Processing...`);
        continue;
      }
      if (entry.type === 'end') {
        // Flush remaining batch
        if (batch.length > 0 && currentCollection) {
          await flushBatch(db, currentCollection, batch, targetUserId);
        }
        const count = stats.byCollection[currentCollection!] || 0;
        console.log(`  [${currentCollection}] Done: ${count} documents`);
        currentCollection = null;
        continue;
      }

      // Data document
      if (!entry.doc || !entry.collection) {
        stats.skipped++;
        continue;
      }

      const collName = entry.collection;
      const targetColl = COLLECTION_MAP[collName];

      if (!targetColl) {
        stats.skipped++;
        continue;
      }

      const doc = transformDoc(entry.doc, collName, targetUserId);
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(db, collName, batch, targetUserId);
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 10) {
        console.error(`  Error line ${stats.total}: ${err}`);
      }
    }
  }

  // Print stats
  console.log('');
  console.log('=== Migration terminée ===');
  console.log(`Total lignes:  ${stats.total}`);
  console.log(`Importés:      ${stats.imported}`);
  console.log(`Ignorés:       ${stats.skipped}`);
  console.log(`Erreurs:       ${stats.errors}`);
  console.log(`ID mappings:   ${idMap.size}`);
  console.log('');
  console.log('Par collection:');
  for (const [coll, count] of Object.entries(stats.byCollection).sort()) {
    console.log(`  ${coll}: ${count}`);
  }

  await mongoose.disconnect();
}

function transformDoc(
  doc: any,
  collName: string,
  targetUserId: mongoose.Types.ObjectId,
): any {
  const transformed: any = { ...doc };

  // Map _id
  const newId = mapId(doc._id);
  transformed._id = newId;

  // Set userId
  transformed.userId = targetUserId;

  // Map reference fields
  const refs = REF_FIELDS[collName] || [];
  for (const field of refs) {
    if (transformed[field]) {
      transformed[field] = mapId(transformed[field]);
    }
  }

  // Convert date strings to Date objects
  for (const key of ['createdAt', 'updatedAt', 'deadline', 'targetDate', 'scheduledDate',
    'statusChangedAt', 'nextTriggerAt', 'snoozedUntilAt', 'acknowledgedAt', 'lastFiredAt',
    'lastClickedAt', 'arrivalDate', 'gmailDate', 'lastSyncAt', 'syncedAt']) {
    if (transformed[key] && typeof transformed[key] === 'string') {
      const d = new Date(transformed[key]);
      if (!isNaN(d.getTime())) {
        transformed[key] = d;
      }
    }
  }

  // Remove Meteor-specific fields
  delete transformed.__v;

  return transformed;
}

async function flushBatch(
  db: mongoose.mongo.Db,
  collName: string,
  batch: any[],
  _targetUserId: mongoose.Types.ObjectId,
) {
  const targetColl = COLLECTION_MAP[collName];
  if (!targetColl) return;

  const coll = db.collection(targetColl);
  const ops = batch.map(doc => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: doc },
      upsert: true,
    },
  }));

  try {
    const result = await coll.bulkWrite(ops, { ordered: false });
    const count = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    stats.imported += count;
    stats.byCollection[collName] = (stats.byCollection[collName] || 0) + count;
  } catch (err: any) {
    stats.errors += batch.length;
    console.error(`  Bulk write error [${collName}]: ${err.message}`);
  }

  batch.length = 0;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
