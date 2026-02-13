import { Router, Response } from 'express';
import { createGunzip, createGzip } from 'zlib';
import { Readable } from 'stream';
import { createInterface } from 'readline';
import multer from 'multer';
import mongoose from 'mongoose';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// --- Collection mapping: Panorama export name → Panoramix MongoDB collection ---
// Supports both camelCase (Panorama UI export) and snake_case (migration script)
const COLLECTION_MAP: Record<string, string> = {
  projects: 'projects',
  tasks: 'tasks',
  notes: 'notes',
  // camelCase (Panorama export)
  noteSessions: 'notesessions',
  noteLines: 'notelines',
  situationActors: 'situationactors',
  situationNotes: 'situationnotes',
  situationQuestions: 'situationquestions',
  situationSummaries: 'situationsummaries',
  budgetLines: 'budgetlines',
  userLogs: 'userlogs',
  calendarEvents: 'calendarevents',
  // snake_case (migration script)
  note_sessions: 'notesessions',
  note_lines: 'notelines',
  situation_actors: 'situationactors',
  situation_notes: 'situationnotes',
  situation_questions: 'situationquestions',
  situation_summaries: 'situationsummaries',
  calendar_events: 'calendarevents',
  // common
  alarms: 'alarms',
  links: 'links',
  teams: 'teams',
  people: 'people',
  situations: 'situations',
  files: 'filedocs',
};

// Reference fields (Meteor string IDs to map)
const REF_FIELDS: Record<string, string[]> = {
  tasks: ['projectId'],
  notes: ['projectId'],
  noteSessions: ['projectId'],
  note_sessions: ['projectId'],
  noteLines: ['sessionId'],
  note_lines: ['sessionId'],
  links: ['projectId'],
  files: ['projectId'],
  situations: [],
  situationActors: ['situationId', 'personId'],
  situation_actors: ['situationId', 'personId'],
  situationNotes: ['situationId', 'actorId'],
  situation_notes: ['situationId', 'actorId'],
  situationQuestions: ['situationId', 'actorId'],
  situation_questions: ['situationId', 'actorId'],
  situationSummaries: ['situationId'],
  situation_summaries: ['situationId'],
  people: ['teamId'],
  budgetLines: ['projectId'],
};

// Date fields to convert
const DATE_FIELDS = [
  'createdAt', 'updatedAt', 'deadline', 'targetDate', 'scheduledDate',
  'statusChangedAt', 'nextTriggerAt', 'snoozedUntilAt', 'acknowledgedAt', 'lastFiredAt',
  'lastClickedAt', 'arrivalDate', 'gmailDate', 'lastSyncAt', 'syncedAt',
];

// --- Export: collection name → MongoDB collection name ---
const EXPORT_COLLECTIONS = [
  { exportName: 'projects', dbCollection: 'projects' },
  { exportName: 'tasks', dbCollection: 'tasks' },
  { exportName: 'notes', dbCollection: 'notes' },
  { exportName: 'note_sessions', dbCollection: 'notesessions' },
  { exportName: 'note_lines', dbCollection: 'notelines' },
  { exportName: 'teams', dbCollection: 'teams' },
  { exportName: 'people', dbCollection: 'people' },
  { exportName: 'links', dbCollection: 'links' },
  { exportName: 'files', dbCollection: 'filedocs' },
  { exportName: 'alarms', dbCollection: 'alarms' },
  { exportName: 'budgetLines', dbCollection: 'budgetlines' },
  { exportName: 'calendar_events', dbCollection: 'calendarevents' },
  { exportName: 'situations', dbCollection: 'situations' },
  { exportName: 'situation_actors', dbCollection: 'situationactors' },
  { exportName: 'situation_notes', dbCollection: 'situationnotes' },
  { exportName: 'situation_questions', dbCollection: 'situationquestions' },
  { exportName: 'situation_summaries', dbCollection: 'situationsummaries' },
  { exportName: 'userLogs', dbCollection: 'userlogs' },
];

// ===================== IMPORT =====================

// POST /data/import — Import NDJSON or NDJSON.gz
router.post('/import', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Fichier requis' });
      return;
    }

    const isGzip = file.originalname.endsWith('.gz') || file.mimetype === 'application/gzip';

    // Create readable stream from buffer
    let inputStream: NodeJS.ReadableStream = Readable.from(file.buffer);
    if (isGzip) {
      const gunzip = createGunzip();
      inputStream = inputStream.pipe(gunzip);
    }

    const rl = createInterface({ input: inputStream });
    const db = mongoose.connection.db!;
    const idMap = new Map<string, mongoose.Types.ObjectId>();

    function mapId(oldId: string | null | undefined): mongoose.Types.ObjectId | null {
      if (!oldId) return null;
      if (!idMap.has(oldId)) {
        idMap.set(oldId, new mongoose.Types.ObjectId());
      }
      return idMap.get(oldId)!;
    }

    const stats = {
      total: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      byCollection: {} as Record<string, number>,
    };

    let currentCollection: string | null = null;
    const batch: any[] = [];
    const BATCH_SIZE = 100;

    const flushBatch = async (collName: string) => {
      const targetColl = COLLECTION_MAP[collName];
      if (!targetColl || batch.length === 0) return;

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
      }

      batch.length = 0;
    };

    for await (const line of rl) {
      stats.total++;
      try {
        const entry = JSON.parse(line);

        if (entry.type === 'begin') {
          currentCollection = entry.collection;
          continue;
        }
        if (entry.type === 'end') {
          if (batch.length > 0 && currentCollection) {
            await flushBatch(currentCollection);
          }
          currentCollection = null;
          continue;
        }

        if (!entry.doc || !entry.collection) {
          stats.skipped++;
          continue;
        }

        const collName = entry.collection;
        if (!COLLECTION_MAP[collName]) {
          stats.skipped++;
          continue;
        }

        // Transform document
        const doc: any = { ...entry.doc };
        doc._id = mapId(doc._id);
        doc.userId = new mongoose.Types.ObjectId(userId);

        // Map reference fields
        const refs = REF_FIELDS[collName] || [];
        for (const field of refs) {
          if (doc[field]) {
            doc[field] = mapId(doc[field]);
          }
        }

        // Convert date strings
        for (const key of DATE_FIELDS) {
          if (doc[key] && typeof doc[key] === 'string') {
            const d = new Date(doc[key]);
            if (!isNaN(d.getTime())) doc[key] = d;
          }
        }

        delete doc.__v;

        batch.push(doc);

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(collName);
        }
      } catch {
        stats.errors++;
      }
    }

    // Flush last batch
    if (batch.length > 0 && currentCollection) {
      await flushBatch(currentCollection);
    }

    res.json({
      message: 'Import terminé',
      stats: {
        totalLines: stats.total,
        imported: stats.imported,
        skipped: stats.skipped,
        errors: stats.errors,
        idMappings: idMap.size,
        byCollection: stats.byCollection,
      },
    });
  } catch (error: any) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Erreur import: ' + error.message });
  }
});

// ===================== EXPORT =====================

// GET /data/export — Export all user data as NDJSON.gz
router.get('/export', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="panoramix-export-${new Date().toISOString().slice(0, 10)}.ndjson.gz"`);

    const db = mongoose.connection.db!;
    const gzip = createGzip();
    gzip.pipe(res);

    const userOid = new mongoose.Types.ObjectId(userId);

    for (const { exportName, dbCollection } of EXPORT_COLLECTIONS) {
      gzip.write(JSON.stringify({ type: 'begin', collection: exportName }) + '\n');

      const docs = await db.collection(dbCollection).find({ userId: userOid }).toArray();
      for (const doc of docs) {
        gzip.write(JSON.stringify({ type: 'data', collection: exportName, doc }) + '\n');
      }

      gzip.write(JSON.stringify({ type: 'end', collection: exportName }) + '\n');
    }

    gzip.end();
  } catch (error: any) {
    console.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur export: ' + error.message });
    }
  }
});

export default router;
