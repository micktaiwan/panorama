import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebApp } from 'meteor/webapp';
import { Random } from 'meteor/random';
import { FilesCollection } from './collections';
import { AppPreferencesCollection } from '../appPreferences/collections';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

// The order of preference for determining the storage directory is:
// 1. User-defined directory from AppPreferencesCollection
// 2. Environment variable PANORAMA_FILES_DIR
// 3. Meteor settings filesDir
// 4. Default directory in the user's home directory named 'PanoramaFiles'
const getStorageDir = async () => {
  const pref = await AppPreferencesCollection.findOneAsync({});
  const fromPrefs = pref?.filesDir && typeof pref.filesDir === 'string' && pref.filesDir.trim() ? pref.filesDir.trim() : null;
  const base = fromPrefs || process.env.PANORAMA_FILES_DIR || (Meteor.settings?.filesDir) || path.join(os.homedir(), 'PanoramaFiles');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
};

const sanitizeName = (name) => String(name || '').trim();

Meteor.methods({
  async 'files.insert'({ projectId, name, originalName, contentBase64, mimeType }) {
    check(projectId, Match.Maybe(String));
    check(name, String);
    check(originalName, String);
    check(contentBase64, String);
    check(mimeType, Match.Maybe(String));
    ensureLoggedIn(this.userId);
    const cleanName = sanitizeName(name);
    if (!cleanName) throw new Meteor.Error('invalid-name', 'File name is required');
    const storageDir = await getStorageDir();
    const uniqueId = Random.id();
    const safeOriginal = String(originalName || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const storedFileName = `${cleanName}__${uniqueId}__${safeOriginal}`;
    const filePath = path.join(storageDir, storedFileName);
    const buffer = Buffer.from(contentBase64, 'base64');
    await fs.promises.writeFile(filePath, buffer);
    const now = new Date();
    const _id = await FilesCollection.insertAsync({
      userId: this.userId,
      projectId: projectId || '__none__',
      name: cleanName,
      originalName: originalName || null,
      storedFileName,
      size: buffer.length,
      mimeType: mimeType || 'application/octet-stream',
      createdAt: now,
      updatedAt: now,
      clicksCount: 0,
      lastClickedAt: null,
    });
    return _id;
  },
  async 'files.update'(fileId, modifier) {
    check(fileId, String);
    check(modifier, Object);
    ensureLoggedIn(this.userId);
    await ensureOwner(FilesCollection, fileId, this.userId);
    const updates = {};
    if (typeof modifier.name === 'string') updates.name = sanitizeName(modifier.name);
    if (typeof modifier.projectId === 'string') updates.projectId = modifier.projectId || '__none__';
    updates.updatedAt = new Date();
    await FilesCollection.updateAsync(fileId, { $set: updates });
    return true;
  },
  async 'files.remove'(fileId) {
    check(fileId, String);
    ensureLoggedIn(this.userId);
    const f = await ensureOwner(FilesCollection, fileId, this.userId);
    if (f?.storedFileName) {
      try {
        const storageDir = await getStorageDir();
        const p = path.join(storageDir, f.storedFileName);
        if (fs.existsSync(p)) await fs.promises.unlink(p);
      } catch (e) {
        console.error('files.remove unlink failed', e);
      }
    }
    await FilesCollection.removeAsync(fileId);
    return true;
  },
  async 'files.registerClick'(fileId) {
    check(fileId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(FilesCollection, fileId, this.userId);
    await FilesCollection.updateAsync(fileId, { $set: { lastClickedAt: new Date() }, $inc: { clicksCount: 1 } });
    return true;
  }
});

// HTTP route to serve stored files (authenticated)
WebApp.connectHandlers.use(async (req, res, next) => {
  if (!req.url.startsWith('/files/')) return next();
  const { resolveUserId } = await import('/imports/api/_shared/httpAuth');
  const userId = await resolveUserId(req);
  if (!userId) { res.statusCode = 401; res.end('Unauthorized'); return; }
  const name = decodeURIComponent(req.url.replace('/files/', '').split('?')[0]);
  if (!name) { res.statusCode = 400; res.end('Bad request'); return; }
  const fileDoc = await FilesCollection.findOneAsync({ storedFileName: name, userId });
  if (!fileDoc) { res.statusCode = 404; res.end('Not found'); return; }
  const storageDir = await getStorageDir();
  const p = path.join(storageDir, name);
  if (!fs.existsSync(p)) { res.statusCode = 404; res.end('Not found'); return; }
  try {
    const stat = fs.statSync(p);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Type', fileDoc.mimeType || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error('file serve failed', e);
    res.statusCode = 500;
    res.end('Server error');
  }
});


