import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { WebApp } from 'meteor/webapp';
import { Random } from 'meteor/random';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createInterface } from 'readline';

// ---------------------------------------------------------------------------
// Job tracking
// ---------------------------------------------------------------------------
const importJobs = new Map(); // jobId -> { ready, error, progress, stats, userId }
const activeImportUsers = new Set(); // prevent concurrent imports per user

// Max upload size: 50 MB
const MAX_BODY = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Collection map — mirrors the 22 collections from the export
// ---------------------------------------------------------------------------
const COLLECTION_MAP = {
  projects:             () => import('/imports/api/projects/collections').then(m => m.ProjectsCollection),
  tasks:                () => import('/imports/api/tasks/collections').then(m => m.TasksCollection),
  notes:                () => import('/imports/api/notes/collections').then(m => m.NotesCollection),
  noteSessions:         () => import('/imports/api/noteSessions/collections').then(m => m.NoteSessionsCollection),
  noteLines:            () => import('/imports/api/noteLines/collections').then(m => m.NoteLinesCollection),
  alarms:               () => import('/imports/api/alarms/collections').then(m => m.AlarmsCollection),
  links:                () => import('/imports/api/links/collections').then(m => m.LinksCollection),
  files:                () => import('/imports/api/files/collections').then(m => m.FilesCollection),
  teams:                () => import('/imports/api/teams/collections').then(m => m.TeamsCollection),
  people:               () => import('/imports/api/people/collections').then(m => m.PeopleCollection),
  situations:           () => import('/imports/api/situations/collections').then(m => m.SituationsCollection),
  situationActors:      () => import('/imports/api/situationActors/collections').then(m => m.SituationActorsCollection),
  situationNotes:       () => import('/imports/api/situationNotes/collections').then(m => m.SituationNotesCollection),
  situationQuestions:   () => import('/imports/api/situationQuestions/collections').then(m => m.SituationQuestionsCollection),
  situationSummaries:   () => import('/imports/api/situationSummaries/collections').then(m => m.SituationSummariesCollection),
  budgetLines:          () => import('/imports/api/budget/collections').then(m => m.BudgetLinesCollection),
  appPreferences:       () => import('/imports/api/appPreferences/collections').then(m => m.AppPreferencesCollection),
  chats:                () => import('/imports/api/chats/collections').then(m => m.ChatsCollection),
  errors:               () => import('/imports/api/errors/collections').then(m => m.ErrorsCollection),
  userLogs:             () => import('/imports/api/userLogs/collections').then(m => m.UserLogsCollection),
  vendorsCache:         () => import('/imports/api/budget/collections').then(m => m.VendorsCacheCollection),
  vendorsIgnore:        () => import('/imports/api/budget/collections').then(m => m.VendorsIgnoreCollection),
};

// ---------------------------------------------------------------------------
// Auth helper: resolve userId from a raw login token
// ---------------------------------------------------------------------------
async function resolveUserFromToken(rawToken) {
  if (!rawToken) return null;
  const hashed = Accounts._hashLoginToken(rawToken);
  const user = await Meteor.users.findOneAsync({
    'services.resume.loginTokens.hashedToken': hashed,
  });
  return user?._id || null;
}

// ---------------------------------------------------------------------------
// Process import job (streaming)
// ---------------------------------------------------------------------------
async function processImportJob(jobId, filePath, userId) {
  const job = importJobs.get(jobId);
  const stats = { inserted: 0, updated: 0, skipped: 0, errors: 0, collections: [] };

  try {
    const input = fs.createReadStream(filePath);
    const gunzip = zlib.createGunzip();
    const rl = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });

    let currentCollection = null;
    let currentCol = null; // resolved Mongo collection
    let batch = [];
    let totalLines = 0;

    const flushBatch = async () => {
      if (batch.length === 0 || !currentCol) return;
      const ops = batch.map(doc => {
        const { _id, ...rest } = doc;
        return {
          updateOne: {
            filter: { _id },
            update: { $set: rest },
            upsert: true,
          },
        };
      });
      try {
        const raw = currentCol.rawCollection();
        const result = await raw.bulkWrite(ops, { ordered: false });
        stats.inserted += (result.upsertedCount || 0);
        stats.updated += (result.modifiedCount || 0);
      } catch (e) {
        // bulkWrite partial failures still count
        stats.errors += batch.length;
        console.error(`[import] bulkWrite error in ${currentCollection}:`, e.message);
      }
      batch = [];
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      totalLines++;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        stats.skipped++;
        continue;
      }

      const { collection, type, doc } = parsed;

      // Begin marker — switch collection context
      if (type === 'begin' && collection) {
        // Flush any leftover from previous collection
        await flushBatch();

        currentCollection = collection;
        const resolver = COLLECTION_MAP[collection];
        if (resolver) {
          try {
            currentCol = await resolver();
            if (!stats.collections.includes(collection)) {
              stats.collections.push(collection);
            }
          } catch (e) {
            console.error(`[import] Failed to resolve collection ${collection}:`, e.message);
            currentCol = null;
          }
        } else {
          currentCol = null;
          stats.skipped++;
        }
        continue;
      }

      // End marker — flush
      if (type === 'end') {
        await flushBatch();
        currentCol = null;
        currentCollection = null;
        continue;
      }

      // Document line
      if (doc && currentCol) {
        // Reassign userId to current user
        doc.userId = userId;
        batch.push(doc);
        if (batch.length >= 100) {
          await flushBatch();
        }
      }

      // Update progress periodically
      if (totalLines % 200 === 0) {
        job.progress = { lines: totalLines };
        job.stats = { ...stats };
      }
    }

    // Final flush
    await flushBatch();

    job.progress = { lines: totalLines };
    job.stats = { ...stats };
    job.ready = true;
  } catch (e) {
    console.error('[import] processImportJob failed', e);
    job.error = { message: e?.message ?? String(e) };
  } finally {
    activeImportUsers.delete(userId);
    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// HTTP upload route
// ---------------------------------------------------------------------------
WebApp.connectHandlers.use('/upload-import', async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Auth
  const token = req.headers['x-auth-token'];
  const userId = await resolveUserFromToken(token);
  if (!userId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Concurrency guard
  if (activeImportUsers.has(userId)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'An import is already running' }));
    return;
  }

  // Read body into temp file with size limit
  const tmpPath = path.join(os.tmpdir(), `panorama-import-${Random.id()}.ndjson.gz`);
  const ws = fs.createWriteStream(tmpPath);
  let received = 0;
  let aborted = false;

  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY) {
        aborted = true;
        req.destroy();
        ws.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        reject(new Error('File too large'));
        return;
      }
      ws.write(chunk);
    });
    req.on('end', () => { ws.end(resolve); });
    req.on('error', reject);
    ws.on('error', reject);
  }).catch((e) => {
    if (!aborted) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    res.writeHead(e.message === 'File too large' ? 413 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
    return null;
  });

  if (aborted || res.writableEnded) return;

  // Audit log
  try {
    const { auditLog } = await import('/imports/api/_shared/audit.js');
    auditLog('data.import', { userId, type: 'archive', size: received });
  } catch { /* non-critical */ }

  // Create job
  const jobId = Random.id();
  activeImportUsers.add(userId);
  importJobs.set(jobId, {
    ready: false,
    error: null,
    progress: { lines: 0 },
    stats: { inserted: 0, updated: 0, skipped: 0, errors: 0, collections: [] },
    userId,
  });

  // Launch async processing
  processImportJob(jobId, tmpPath, userId);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jobId }));
});

// ---------------------------------------------------------------------------
// Status method (DDP polling)
// ---------------------------------------------------------------------------
Meteor.methods({
  'app.importArchiveStatus'(jobId) {
    const j = importJobs.get(jobId);
    if (!j) return { exists: false };
    return {
      exists: true,
      ready: j.ready,
      error: j.error || null,
      progress: j.progress || null,
      stats: j.stats || null,
    };
  },
});
