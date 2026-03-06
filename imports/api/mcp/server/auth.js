// MCP API Key authentication — cache + constant-time resolution
// Maintains an in-memory Map<apiKey, userId> synced via observe()

import crypto from 'crypto';
import { UserPreferencesCollection } from '/imports/api/userPreferences/collections';

const API_KEY_CACHE = new Map(); // apiKey -> userId

// Populate cache at startup and keep it in sync
const cursor = UserPreferencesCollection.find(
  { mcpApiKey: { $exists: true, $ne: null } },
  { fields: { userId: 1, mcpApiKey: 1 } }
);

cursor.observeAsync({
  added(doc) {
    if (doc.mcpApiKey) API_KEY_CACHE.set(doc.mcpApiKey, doc.userId);
  },
  changed(newDoc, oldDoc) {
    if (oldDoc.mcpApiKey) API_KEY_CACHE.delete(oldDoc.mcpApiKey);
    if (newDoc.mcpApiKey) API_KEY_CACHE.set(newDoc.mcpApiKey, newDoc.userId);
  },
  removed(oldDoc) {
    if (oldDoc.mcpApiKey) API_KEY_CACHE.delete(oldDoc.mcpApiKey);
  },
});

/**
 * Resolve a userId from an API key using constant-time comparison.
 * Returns userId or null.
 */
export function resolveUserIdFromApiKey(token) {
  if (!token || typeof token !== 'string') return null;
  const tokenBuf = Buffer.from(token);
  for (const [key, userId] of API_KEY_CACHE) {
    const keyBuf = Buffer.from(key);
    if (tokenBuf.length === keyBuf.length && crypto.timingSafeEqual(tokenBuf, keyBuf)) {
      return userId;
    }
  }
  return null;
}

/**
 * Extract auth token from request (Authorization: Bearer or X-API-Key header).
 */
export function extractAuthToken(req) {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-api-key'] || null;
}

console.log('[mcp] API key auth cache initialized');
