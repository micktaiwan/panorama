import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { Random } from 'meteor/random';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// Collections (dynamic imports inside job to avoid server-start cost if unused)

const jobs = new Map(); // jobId -> { ready:boolean, filePath:string, size:number }

// Feature flag for the minimal mobile tasks page (LAN)
let mobileTasksEnabled = false;

Meteor.methods({
  'mobileTasksRoute.setEnabled'(enabled) {
    const v = !!enabled;
    mobileTasksEnabled = v;
    return { enabled: v };
  },
  'mobileTasksRoute.getStatus'() {
    return { enabled: !!mobileTasksEnabled };
  },
  'mobileTasksRoute.getLanIps'() {
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(ifaces)) {
      const list = ifaces[name] || [];
      for (const info of list) {
        if (info && info.family === 'IPv4' && !info.internal && typeof info.address === 'string') {
          ips.push(info.address);
        }
      }
    }
    return { ips };
  }
});

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
  // Local-only collections: export all
  await writeCollectionNdjson(gzip, 'alarms', AlarmsCollection);
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
    const { ensureLoggedIn } = await import('/imports/api/_shared/auth');
    ensureLoggedIn(this.userId);
    const userId = this.userId;
    const id = Random.id();
    jobs.set(id, { ready: false, filePath: null, size: 0, error: null });
    // Run async; do not await in method
    setTimeout(() => {
      startArchiveJob(id, userId)
        .then(() => {})
        .catch((e) => {
          console.error('exportArchive job failed', e);
          jobs.set(id, {
            ready: false,
            filePath: null,
            size: 0,
            error: { message: e?.message ?? String(e), stack: e?.stack ?? '' }
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
    try {
      if (j?.filePath && fs.existsSync(j.filePath)) fs.unlinkSync(j.filePath);
    } catch (e) {
      console.error('Failed to delete export temp file', e);
    }
    jobs.delete(jobId);
  });
});

// Minimal dark HTML route rendering open tasks for quick mobile viewing
WebApp.connectHandlers.use(async (req, res, next) => {
  if (req.url !== '/tasks-mobile') return next();

  if (!mobileTasksEnabled) {
    res.statusCode = 404;
    res.end('Mobile tasks page is disabled');
    return;
  }

  try {
    const { TasksCollection } = await import('/imports/api/tasks/collections');
    const { ProjectsCollection } = await import('/imports/api/projects/collections');

    // Fetch open tasks with fields needed
    const tasks = await TasksCollection.find(
      { $or: [ { status: { $exists: false } }, { status: { $nin: ['done', 'cancelled'] } } ] },
      { fields: { title: 1, projectId: 1, status: 1, deadline: 1 } }
    ).fetchAsync();

    // Build project map
    const projIds = Array.from(new Set((tasks || []).map(t => t.projectId).filter(Boolean)));
    const projects = projIds.length > 0
      ? await ProjectsCollection.find({ _id: { $in: projIds } }, { fields: { name: 1 } }).fetchAsync()
      : [];
    const projectById = new Map(projects.map(p => [p._id, p]));

    // Sort: deadline asc (nulls last), then status (in_progress first), then createdAt asc if available
    const toTime = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
    const statusRank = (s) => (s === 'in_progress' ? 0 : 1);
    const sorted = [...(tasks || [])].sort((a, b) => {
      const ad = toTime(a.deadline); const bd = toTime(b.deadline);
      if (ad !== bd) return ad - bd;
      const as = statusRank(a.status || 'todo'); const bs = statusRank(b.status || 'todo');
      if (as !== bs) return as - bs;
      const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ac - bc;
    });

    // Format date
    const fmt = (d) => {
      if (!d) return '';
      try { const dt = new Date(d); return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10); } catch { return ''; }
    };

    const escapeHtml = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const rows = sorted.map(t => {
      const projectName = t.projectId && projectById.get(t.projectId) ? (projectById.get(t.projectId).name || '') : '';
      const deadline = fmt(t.deadline);
      const status = t.status || 'todo';
      return `<tr>
        <td class="c-deadline">${escapeHtml(deadline)}</td>
        <td class="c-status ${status === 'in_progress' ? 'pill' : ''}">${escapeHtml(status)}</td>
        <td class="c-title">${escapeHtml(t.title || '')}</td>
        <td class="c-project">${escapeHtml(projectName)}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Panorama — Tasks</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, Helvetica, Arial, sans-serif; background: #0b0f13; color: #e5e7eb; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 16px; }
    h1 { font-size: 18px; font-weight: 600; margin: 8px 0 16px; color: #e5e7eb; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #1f2937; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; }
    tr:hover { background: #0f141a; }
    .c-deadline { white-space: nowrap; color: #9ca3af; width: 1%; }
    .c-status { white-space: nowrap; font-size: 12px; color: #cbd5e1; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #1f2937; color: #e5e7eb; }
    .c-title { font-weight: 500; color: #e5e7eb; }
    .c-project { color: #9ca3af; white-space: nowrap; }
    .meta { font-size: 12px; color: #9ca3af; margin-bottom: 8px; }
  </style>
  <meta name="robots" content="noindex, nofollow" />
</head>
<body>
  <div class="wrap">
    <h1>Tâches ouvertes</h1>
    <div class="meta">${sorted.length} tâches</div>
    <table>
      <thead>
        <tr>
          <th>Deadline</th>
          <th>Statut</th>
          <th>Tâche</th>
          <th>Projet</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    console.error('[tasks-mobile] failed', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Internal server error');
  }
});

// Redirect root to tasks list when accessed via LAN IP (so typing just the IP works)
WebApp.connectHandlers.use((req, res, next) => {
  if (req.url !== '/' && req.url !== '') return next();
  const host = String(req.headers?.host || '').split(':')[0];
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalHost) return next();
  if (!mobileTasksEnabled) return next();
  res.statusCode = 302;
  res.setHeader('Location', '/tasks-mobile');
  res.end('Redirecting to /tasks-mobile');
});


