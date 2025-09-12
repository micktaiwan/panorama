import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { Random } from 'meteor/random';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// Collections (dynamic imports inside job to avoid server-start cost if unused)

const jobs = new Map(); // jobId -> { ready:boolean, filePath:string, size:number }

const writeCollectionNdjson = async (stream, name, col) => {
  // Header line to delimit collections
  stream.write(Buffer.from(JSON.stringify({ collection: name, type: 'begin' }) + '\n'));
  const cursor = col.find({});
  const batch = await cursor.fetchAsync();
  for (const doc of batch) {
    stream.write(Buffer.from(JSON.stringify({ collection: name, doc }) + '\n'));
  }
  stream.write(Buffer.from(JSON.stringify({ collection: name, type: 'end' }) + '\n'));
};

const startArchiveJob = async (jobId) => {
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

  await writeCollectionNdjson(gzip, 'projects', ProjectsCollection);
  await writeCollectionNdjson(gzip, 'tasks', TasksCollection);
  await writeCollectionNdjson(gzip, 'notes', NotesCollection);
  await writeCollectionNdjson(gzip, 'noteSessions', NoteSessionsCollection);
  await writeCollectionNdjson(gzip, 'noteLines', NoteLinesCollection);
  await writeCollectionNdjson(gzip, 'alarms', AlarmsCollection);
  await writeCollectionNdjson(gzip, 'links', LinksCollection);
  await writeCollectionNdjson(gzip, 'files', FilesCollection);
  await writeCollectionNdjson(gzip, 'teams', TeamsCollection);
  await writeCollectionNdjson(gzip, 'people', PeopleCollection);
  await writeCollectionNdjson(gzip, 'situations', SituationsCollection);
  await writeCollectionNdjson(gzip, 'situationActors', SituationActorsCollection);
  await writeCollectionNdjson(gzip, 'situationNotes', SituationNotesCollection);
  await writeCollectionNdjson(gzip, 'situationQuestions', SituationQuestionsCollection);
  await writeCollectionNdjson(gzip, 'situationSummaries', SituationSummariesCollection);
  await writeCollectionNdjson(gzip, 'budgetLines', BudgetLinesCollection);
  await writeCollectionNdjson(gzip, 'appPreferences', AppPreferencesCollection);
  await writeCollectionNdjson(gzip, 'chats', ChatsCollection);
  await writeCollectionNdjson(gzip, 'errors', ErrorsCollection);
  await writeCollectionNdjson(gzip, 'userLogs', UserLogsCollection);
  await writeCollectionNdjson(gzip, 'vendorsCache', VendorsCacheCollection);
  await writeCollectionNdjson(gzip, 'vendorsIgnore', VendorsIgnoreCollection);

  gzip.end();
  await new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
  });

  const size = fs.statSync(outPath).size;
  jobs.set(jobId, { ready: true, filePath: outPath, size });
};

Meteor.methods({
  async 'app.exportArchiveStart'() {
    const id = Random.id();
    jobs.set(id, { ready: false, filePath: null, size: 0 });
    // Run async; do not await in method
    setTimeout(() => { startArchiveJob(id).catch((e) => { console.error('exportArchive job failed', e); jobs.delete(id); }); }, 0);
    return { jobId: id };
  },
  async 'app.exportArchiveStatus'(jobId) {
    const j = jobs.get(jobId);
    if (!j) return { exists: false };
    return { exists: true, ready: j.ready, size: j.size };
  }
});

// HTTP download route
WebApp.connectHandlers.use((req, res, next) => {
  if (!req.url.startsWith('/download-export/')) return next();
  const jobId = req.url.replace('/download-export/', '').split('?')[0];
  const j = jobs.get(jobId);
  if (!j || !j.ready || !j.filePath) {
    res.statusCode = 404;
    res.end('Export not found or not ready');
    return;
  }
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="panorama-export-${jobId}.ndjson.gz"`);
  const read = fs.createReadStream(j.filePath);
  read.pipe(res);
  read.on('close', () => {
    // Optionally clean up the temp file
    try { fs.unlinkSync(j.filePath); } catch (e) {}
    jobs.delete(jobId);
  });
});


