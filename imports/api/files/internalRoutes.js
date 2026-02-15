// Internal HTTP API for file operations on the VPS.
// Protected by a shared API key (X-API-Key header).
// Used by the local Meteor instance to delegate file I/O to the VPS.

import { WebApp } from 'meteor/webapp';
import fs from 'fs';
import path from 'path';
import { getStorageDir } from './methods';

const API_KEY = process.env.PANORAMA_FILES_API_KEY;

const checkApiKey = (req, res) => {
  if (!API_KEY) {
    res.statusCode = 503;
    res.end('File API not configured');
    return false;
  }
  if (req.headers['x-api-key'] !== API_KEY) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return false;
  }
  return true;
};

// POST /api/files/store — { storedFileName, contentBase64 }
WebApp.connectHandlers.use('/api/files/store', async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }
  if (!checkApiKey(req, res)) return;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const { storedFileName, contentBase64 } = body;
    if (!storedFileName || !contentBase64) {
      res.statusCode = 400;
      res.end('Missing storedFileName or contentBase64');
      return;
    }

    const safeName = path.basename(storedFileName);
    const storageDir = await getStorageDir();
    const filePath = path.join(storageDir, safeName);
    const buffer = Buffer.from(contentBase64, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    res.statusCode = 200;
    res.end('OK');
  } catch (e) {
    console.error('[api/files/store] Error:', e);
    res.statusCode = 500;
    res.end('Server error');
  }
});

// GET /api/files/raw/<name>
WebApp.connectHandlers.use('/api/files/raw/', async (req, res) => {
  if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return; }
  if (!checkApiKey(req, res)) return;

  try {
    const name = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
    if (!name) { res.statusCode = 400; res.end('Missing file name'); return; }

    const safeName = path.basename(name);
    const storageDir = await getStorageDir();
    const filePath = path.join(storageDir, safeName);

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error('[api/files/raw] Error:', e);
    res.statusCode = 500;
    res.end('Server error');
  }
});

// POST /api/files/delete — { storedFileName }
WebApp.connectHandlers.use('/api/files/delete', async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }
  if (!checkApiKey(req, res)) return;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const { storedFileName } = body;
    if (!storedFileName) {
      res.statusCode = 400;
      res.end('Missing storedFileName');
      return;
    }

    const safeName = path.basename(storedFileName);
    const storageDir = await getStorageDir();
    const filePath = path.join(storageDir, safeName);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    res.statusCode = 200;
    res.end('OK');
  } catch (e) {
    console.error('[api/files/delete] Error:', e);
    res.statusCode = 500;
    res.end('Server error');
  }
});
