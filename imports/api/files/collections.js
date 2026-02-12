import { Meteor } from 'meteor/meteor';
import { FilesCollection as OstrioFilesCollection } from 'meteor/ostrio:files';

// storagePath is server-only; use a function to avoid importing Node builtins on client
let storagePath;
if (Meteor.isServer) {
  const path = require('path');
  const os = require('os');
  storagePath = process.env.PANORAMA_FILES_DIR
    || Meteor.settings?.filesDir
    || path.join(os.homedir(), 'PanoramaFiles');
}

const Files = new OstrioFilesCollection({
  collectionName: 'files',
  storagePath: storagePath || undefined,
  downloadRoute: '/files',
  allowClientCode: false,
  protected(fileObj) {
    if (!this.userId || !fileObj) return false;
    return this.userId === fileObj.userId;
  },
  onBeforeUpload(file) {
    if (file.size > 50 * 1024 * 1024) {
      return 'File too large (max 50 MB)';
    }
    return true;
  },
});

// Backward-compatible raw Mongo.Collection for publications and legacy queries
const FilesCollection = Files.collection;

export { Files, FilesCollection };
