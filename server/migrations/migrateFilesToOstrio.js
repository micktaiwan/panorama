/**
 * Migration: Convert legacy file documents to ostrio:files format.
 *
 * Legacy docs have `storedFileName` but no `versions` field.
 * This migration adds the ostrio:files fields so existing files
 * become accessible through the new Files.link() URLs.
 *
 * Physical files are NOT moved on disk.
 *
 * Usage from meteor shell:
 *   import { migrateFilesToOstrio } from '/server/migrations/migrateFilesToOstrio.js';
 *   await migrateFilesToOstrio();
 *
 * Or call the Meteor method:
 *   Meteor.call('migrations.filesToOstrio');
 */

import { Meteor } from 'meteor/meteor';
import fs from 'fs';
import nodePath from 'path';
import os from 'os';
import { FilesCollection } from '/imports/api/files/collections';

const getStoragePath = () => {
  return process.env.PANORAMA_FILES_DIR
    || Meteor.settings?.filesDir
    || nodePath.join(os.homedir(), 'PanoramaFiles');
};

const mimeToExtension = (mimeType) => {
  const map = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/html': 'html',
    'application/json': 'json',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/octet-stream': 'bin',
  };
  return map[mimeType] || 'bin';
};

const getFileType = (mimeType) => {
  const t = String(mimeType || '').toLowerCase();
  return {
    isVideo: t.startsWith('video/'),
    isAudio: t.startsWith('audio/'),
    isImage: t.startsWith('image/'),
    isText: t.startsWith('text/'),
    isJSON: t === 'application/json',
    isPDF: t === 'application/pdf',
  };
};

export async function migrateFilesToOstrio() {
  const base = getStoragePath();
  console.log(`[migration:filesToOstrio] Storage path: ${base}`);

  // Find docs that haven't been migrated yet (no versions field)
  const legacy = await FilesCollection.find({ versions: { $exists: false } }).fetchAsync();
  if (legacy.length === 0) {
    console.log('[migration:filesToOstrio] No legacy files to migrate.');
    return { migrated: 0, skipped: 0 };
  }

  console.log(`[migration:filesToOstrio] Found ${legacy.length} legacy file(s) to migrate.`);

  let migrated = 0;
  let skipped = 0;

  for (const doc of legacy) {
    const storedFileName = doc.storedFileName;
    if (!storedFileName) {
      console.warn(`[migration:filesToOstrio] ${doc._id}: no storedFileName, skipping`);
      skipped++;
      continue;
    }

    const filePath = nodePath.join(base, storedFileName);
    if (!fs.existsSync(filePath)) {
      console.warn(`[migration:filesToOstrio] ${doc._id}: physical file not found at ${filePath}, skipping`);
      skipped++;
      continue;
    }

    const stat = fs.statSync(filePath);
    const mimeType = doc.mimeType || 'application/octet-stream';
    const extension = (doc.originalName || storedFileName).split('.').pop() || mimeToExtension(mimeType);
    const typeFlags = getFileType(mimeType);

    const updates = {
      type: mimeType,
      mime: mimeType,
      'mime-type': mimeType,
      extension,
      ext: extension,
      extensionWithDot: `.${extension}`,
      path: filePath,
      _storagePath: base,
      _downloadRoute: '/files',
      _collectionName: 'files',
      versions: {
        original: {
          path: filePath,
          size: stat.size,
          type: mimeType,
          extension,
        },
      },
      ...typeFlags,
    };

    // Ensure size matches physical file
    if (!doc.size || doc.size !== stat.size) {
      updates.size = stat.size;
    }

    await FilesCollection.updateAsync(doc._id, { $set: updates });
    migrated++;
    console.log(`[migration:filesToOstrio] ${doc._id}: migrated (${doc.name || storedFileName})`);
  }

  console.log(`[migration:filesToOstrio] Done. Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

Meteor.methods({
  async 'migrations.filesToOstrio'() {
    // Allow from server console (no connection) or from a logged-in user
    if (this.connection) {
      const userId = Meteor.userId();
      if (!userId) throw new Meteor.Error('not-authorized');
    }
    return migrateFilesToOstrio();
  },
});
