import crypto from 'crypto';
import { Meteor } from 'meteor/meteor';

// GitHub App authentication: sign a short-lived RS256 JWT with the app private
// key, exchange it for an installation access token (valid ~1h), cache it.
// The private key NEVER leaves the server (read from Meteor.settings / env only).

const b64url = (input) => Buffer.from(input).toString('base64url');

// Private keys in env/settings often carry escaped "\n" — normalize to real newlines.
const normalizeKey = (key) => String(key || '').replace(/\\n/g, '\n').trim();

const makeAppJwt = (appId, privateKey) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), normalizeKey(privateKey));
  return `${signingInput}.${signature.toString('base64url')}`;
};

// installationId -> { token, expiresAt }
const tokenCache = new Map();

const fetchInstallationToken = async ({ appId, installationId, privateKey }) => {
  const cached = tokenCache.get(installationId);
  // Reuse while still valid with a 5-minute safety buffer.
  if (cached && cached.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return cached.token;

  const jwt = makeAppJwt(appId, privateKey);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'panorama-staffing'
    }
  });
  if (res.status === 401) throw new Meteor.Error('github-app-auth', 'GitHub App JWT rejected (check App ID / private key)');
  if (res.status === 404) throw new Meteor.Error('github-app-install', 'Installation not found (check installation id)');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Meteor.Error('github-app-http', `Installation token HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const entry = { token: data.token, expiresAt: new Date(data.expires_at) };
  tokenCache.set(installationId, entry);
  return entry.token;
};

/**
 * Resolve a usable Bearer token from config.
 * Prefers GitHub App (server-side creds); falls back to a PAT if provided.
 * Throws config-missing if neither is available.
 */
export const resolveGithubToken = async (cfg) => {
  const app = cfg?.app;
  if (app?.appId && app?.installationId && app?.privateKey) {
    return fetchInstallationToken(app);
  }
  if (cfg?.token) return cfg.token;
  throw new Meteor.Error('config-missing', 'No GitHub auth: configure a GitHub App (server settings) or a PAT.');
};
