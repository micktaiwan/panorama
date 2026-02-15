import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { Random } from 'meteor/random';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// Collections (dynamic imports inside job to avoid server-start cost if unused)

const jobs = new Map(); // jobId -> { ready, filePath, size, userId }

const writeCollectionNdjson = async (stream, name, col, filter = {}) => {
  // Header line to delimit collections
  stream.write(Buffer.from(JSON.stringify({ collection: name, type: 'begin' }) + '\n'));
  const cursor = col.find(filter);
  const batch = await cursor.fetchAsync();
  for (const doc of batch) {
    stream.write(Buffer.from(JSON.stringify({ collection: name, doc }) + '\n'));
  }
  stream.write(Buffer.from(JSON.stringify({ collection: name, type: 'end' }) + '\n'));
};

const startArchiveJob = async (jobId, userId) => {
  const userFilter = userId ? { userId } : {};
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `panorama-export-${jobId}.ndjson.gz`);
  const gzip = zlib.createGzip({ level: 9 });
  const file = fs.createWriteStream(outPath);
  gzip.pipe(file);

  // Lazy import collections
  const { ProjectsCollection } = await import('/imports/api/projects/collections');
  const { TasksCollection } = await import('/imports/api/tasks/collections');
  const { NotesCollection } = await import('/imports/api/notes/collections');
  const { NoteSessionsCollection } = await import('/imports/api/noteSessions/collections');
  const { NoteLinesCollection } = await import('/imports/api/noteLines/collections');
  const { AlarmsCollection } = await import('/imports/api/alarms/collections');
  const { LinksCollection } = await import('/imports/api/links/collections');
  const { FilesCollection } = await import('/imports/api/files/collections');
  const { TeamsCollection } = await import('/imports/api/teams/collections');
  const { PeopleCollection } = await import('/imports/api/people/collections');
  const { SituationsCollection } = await import('/imports/api/situations/collections');
  const { SituationActorsCollection } = await import('/imports/api/situationActors/collections');
  const { SituationNotesCollection } = await import('/imports/api/situationNotes/collections');
  const { SituationQuestionsCollection } = await import('/imports/api/situationQuestions/collections');
  const { SituationSummariesCollection } = await import('/imports/api/situationSummaries/collections');
  const { BudgetLinesCollection, VendorsCacheCollection, VendorsIgnoreCollection } = await import('/imports/api/budget/collections');
  const { AppPreferencesCollection } = await import('/imports/api/appPreferences/collections');
  const { ChatsCollection } = await import('/imports/api/chats/collections');
  const { ErrorsCollection } = await import('/imports/api/errors/collections');
  const { UserLogsCollection } = await import('/imports/api/userLogs/collections');

  // Remote collections: filter by userId
  await writeCollectionNdjson(gzip, 'projects', ProjectsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'tasks', TasksCollection, userFilter);
  await writeCollectionNdjson(gzip, 'notes', NotesCollection, userFilter);
  await writeCollectionNdjson(gzip, 'noteSessions', NoteSessionsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'noteLines', NoteLinesCollection, userFilter);
  await writeCollectionNdjson(gzip, 'links', LinksCollection, userFilter);
  await writeCollectionNdjson(gzip, 'files', FilesCollection, userFilter);
  // Previously local-only collections: now filter by userId
  await writeCollectionNdjson(gzip, 'alarms', AlarmsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'teams', TeamsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'people', PeopleCollection, userFilter);
  await writeCollectionNdjson(gzip, 'situations', SituationsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'situationActors', SituationActorsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'situationNotes', SituationNotesCollection, userFilter);
  await writeCollectionNdjson(gzip, 'situationQuestions', SituationQuestionsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'situationSummaries', SituationSummariesCollection, userFilter);
  await writeCollectionNdjson(gzip, 'budgetLines', BudgetLinesCollection, userFilter);
  // appPreferences is a global singleton - no userId filter
  await writeCollectionNdjson(gzip, 'appPreferences', AppPreferencesCollection);
  await writeCollectionNdjson(gzip, 'chats', ChatsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'errors', ErrorsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'userLogs', UserLogsCollection, userFilter);
  await writeCollectionNdjson(gzip, 'vendorsCache', VendorsCacheCollection, userFilter);
  await writeCollectionNdjson(gzip, 'vendorsIgnore', VendorsIgnoreCollection, userFilter);

  gzip.end();
  await new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
  });

  const size = fs.statSync(outPath).size;
  const existing = jobs.get(jobId);
  jobs.set(jobId, { ready: true, filePath: outPath, size, userId: existing?.userId });
};

Meteor.methods({
  async 'app.exportArchiveStart'() {
    const { ensureLoggedIn } = await import('/imports/api/_shared/auth');
    ensureLoggedIn(this.userId);
    const userId = this.userId;
    const id = Random.id();
    jobs.set(id, { ready: false, filePath: null, size: 0, error: null, userId });
    // Run async; do not await in method
    setTimeout(() => {
      startArchiveJob(id, userId)
        .then(() => {})
        .catch((e) => {
          console.error('exportArchive job failed', e);
          const prev = jobs.get(id);
          jobs.set(id, {
            ready: false,
            filePath: null,
            size: 0,
            error: { message: e?.message ?? String(e), stack: e?.stack ?? '' },
            userId: prev?.userId,
          });
        });
    }, 0);
    return { jobId: id };
  },
  async 'app.exportArchiveStatus'(jobId) {
    const j = jobs.get(jobId);
    if (!j) return { exists: false };
    return { exists: true, ready: j.ready, size: j.size, error: j.error || null };
  }
});

// HTTP download route (authenticated)
WebApp.connectHandlers.use(async (req, res, next) => {
  if (!req.url.startsWith('/download-export/')) return next();
  const { resolveUserId } = await import('/imports/api/_shared/httpAuth');
  const userId = await resolveUserId(req);
  if (!userId) { res.statusCode = 401; res.end('Unauthorized'); return; }
  const jobId = req.url.replace('/download-export/', '').split('?')[0];
  const j = jobs.get(jobId);
  if (!j || !j.ready || !j.filePath) {
    res.statusCode = 404;
    res.end('Export not found or not ready');
    return;
  }
  if (j.userId !== userId) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="panorama-export-${jobId}.ndjson.gz"`);
  const read = fs.createReadStream(j.filePath);
  read.pipe(res);
  read.on('close', () => {
    try {
      if (j?.filePath && fs.existsSync(j.filePath)) fs.unlinkSync(j.filePath);
    } catch (e) {
      console.error('Failed to delete export temp file', e);
    }
    jobs.delete(jobId);
  });
});


