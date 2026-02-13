import { Router, Response } from 'express';
import { z } from 'zod';
import { GmailToken, GmailMessage, EmailActionLog } from '../models/GmailToken.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
].join(' ');

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/gmail/callback';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

// --- Helper: get valid access token (auto-refresh) ---
async function getAccessToken(userId: string): Promise<string | null> {
  const token = await GmailToken.findOne({ userId });
  if (!token) return null;

  // Refresh if expired (5min margin)
  if (Date.now() > token.expiryDate - 300_000) {
    const oauth = getOAuthConfig();
    if (!oauth) return null;

    try {
      const resp = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          refresh_token: token.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!resp.ok) return null;
      const data = await resp.json() as any;

      await GmailToken.updateOne(
        { _id: token._id },
        { $set: { accessToken: data.access_token, expiryDate: Date.now() + data.expires_in * 1000 } },
      );

      return data.access_token;
    } catch {
      return null;
    }
  }

  return token.accessToken;
}

async function gmailFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
  const resp = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail API ${resp.status}: ${err}`);
  }
  return resp.json();
}

// --- OAuth flow ---

// GET /gmail/auth-url
router.get('/auth-url', async (req: AuthRequest, res: Response) => {
  const oauth = getOAuthConfig();
  if (!oauth) { res.status(500).json({ error: 'OAuth Google non configuré' }); return; }

  const state = crypto.randomBytes(16).toString('hex');
  const url = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })}`;

  res.json({ url, state });
});

// POST /gmail/exchange — Exchange OAuth code for tokens
router.post('/exchange', async (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: 'code requis' }); return; }

  const oauth = getOAuthConfig();
  if (!oauth) { res.status(500).json({ error: 'OAuth Google non configuré' }); return; }

  try {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      res.status(400).json({ error: `Token exchange failed: ${err}` }); return;
    }

    const data = await resp.json() as any;

    await GmailToken.findOneAndUpdate(
      { userId: req.userId },
      {
        $set: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiryDate: Date.now() + data.expires_in * 1000,
        },
      },
      { upsert: true },
    );

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /gmail/status — Check if connected
router.get('/status', async (req: AuthRequest, res: Response) => {
  const token = await GmailToken.findOne({ userId: req.userId });
  const oauthConfigured = !!getOAuthConfig();
  res.json({
    connected: !!token,
    oauthConfigured,
    expiryDate: token?.expiryDate,
  });
});

// DELETE /gmail/disconnect
router.delete('/disconnect', async (req: AuthRequest, res: Response) => {
  await GmailToken.deleteOne({ userId: req.userId });
  res.json({ ok: true });
});

// --- Messages ---

// GET /gmail/messages — List messages (synced locally)
router.get('/messages', async (req: AuthRequest, res: Response) => {
  const { label, archived, limit = '50', skip = '0' } = req.query;

  const filter: any = { userId: req.userId };
  if (label) filter.labelIds = label;
  if (archived === 'true') filter.archived = true;
  else filter.archived = { $ne: true };

  const messages = await GmailMessage.find(filter)
    .sort({ gmailDate: -1 })
    .skip(Number(skip))
    .limit(Math.min(Number(limit), 200));

  const total = await GmailMessage.countDocuments(filter);
  res.json({ messages, total });
});

// GET /gmail/messages/:messageId
router.get('/messages/:messageId', async (req: AuthRequest, res: Response) => {
  const msg = await GmailMessage.findOne({ userId: req.userId, messageId: req.params.messageId });
  if (!msg) { res.status(404).json({ error: 'Message non trouvé' }); return; }
  res.json(msg);
});

// GET /gmail/threads/:threadId — All messages in a thread
router.get('/threads/:threadId', async (req: AuthRequest, res: Response) => {
  const messages = await GmailMessage.find({
    userId: req.userId,
    threadId: req.params.threadId,
  }).sort({ gmailDate: 1 });
  res.json(messages);
});

// POST /gmail/sync — Fetch messages from Gmail API
router.post('/sync', async (req: AuthRequest, res: Response) => {
  const accessToken = await getAccessToken(req.userId!);
  if (!accessToken) { res.status(401).json({ error: 'Non connecté à Gmail' }); return; }

  const { maxResults = 50, query = 'in:inbox' } = req.body;

  try {
    // List message IDs
    const listData = await gmailFetch(
      accessToken,
      `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query as string)}`,
    );

    const messageIds: string[] = (listData.messages || []).map((m: any) => m.id);
    let imported = 0;

    // Fetch each message (batch, but sequential for simplicity)
    for (const msgId of messageIds) {
      const exists = await GmailMessage.findOne({ userId: req.userId, messageId: msgId });
      if (exists) continue;

      const msgData = await gmailFetch(accessToken, `/messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`);

      const headers = msgData.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      // Get snippet
      const snippet = msgData.snippet || '';

      await GmailMessage.create({
        userId: req.userId,
        messageId: msgData.id,
        threadId: msgData.threadId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        snippet,
        labelIds: msgData.labelIds || [],
        gmailDate: new Date(Number(msgData.internalDate)),
        isRead: !(msgData.labelIds || []).includes('UNREAD'),
        isImportant: (msgData.labelIds || []).includes('IMPORTANT'),
      });
      imported++;
    }

    res.json({ ok: true, imported, total: messageIds.length });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// --- Actions ---

// POST /gmail/messages/:messageId/archive
router.post('/messages/:messageId/archive', async (req: AuthRequest, res: Response) => {
  const accessToken = await getAccessToken(req.userId!);

  // Archive on Gmail API if connected
  if (accessToken) {
    try {
      await gmailFetch(accessToken, `/messages/${req.params.messageId}/modify`, {
        method: 'POST',
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      });
    } catch { /* silent fallback to local */ }
  }

  // Archive locally
  await GmailMessage.updateOne(
    { userId: req.userId, messageId: req.params.messageId },
    { $set: { archived: true } },
  );

  await EmailActionLog.create({
    userId: req.userId,
    messageId: req.params.messageId,
    action: 'archive',
  });

  req.app.get('io')?.to(`user:${req.userId}`).emit('gmail:archived', { messageId: req.params.messageId });
  res.json({ ok: true });
});

// POST /gmail/messages/:messageId/trash
router.post('/messages/:messageId/trash', async (req: AuthRequest, res: Response) => {
  const accessToken = await getAccessToken(req.userId!);

  if (accessToken) {
    try {
      await gmailFetch(accessToken, `/messages/${req.params.messageId}/trash`, { method: 'POST' });
    } catch { /* silent */ }
  }

  await GmailMessage.deleteOne({ userId: req.userId, messageId: req.params.messageId });

  await EmailActionLog.create({
    userId: req.userId,
    messageId: req.params.messageId,
    action: 'trash',
  });

  res.json({ ok: true });
});

// --- Labels ---

// GET /gmail/labels
router.get('/labels', async (req: AuthRequest, res: Response) => {
  const accessToken = await getAccessToken(req.userId!);
  if (!accessToken) { res.status(401).json({ error: 'Non connecté à Gmail' }); return; }

  try {
    const data = await gmailFetch(accessToken, '/labels');
    res.json(data.labels || []);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /gmail/messages/:messageId/labels — Add/remove labels
router.post('/messages/:messageId/labels', async (req: AuthRequest, res: Response) => {
  const accessToken = await getAccessToken(req.userId!);
  if (!accessToken) { res.status(401).json({ error: 'Non connecté à Gmail' }); return; }

  const { addLabelIds = [], removeLabelIds = [] } = req.body;

  try {
    await gmailFetch(accessToken, `/messages/${req.params.messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    });

    // Update local copy
    if (addLabelIds.length) {
      await GmailMessage.updateOne(
        { userId: req.userId, messageId: req.params.messageId },
        { $addToSet: { labelIds: { $each: addLabelIds } } },
      );
    }
    if (removeLabelIds.length) {
      await GmailMessage.updateOne(
        { userId: req.userId, messageId: req.params.messageId },
        { $pull: { labelIds: { $in: removeLabelIds } } },
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// --- Stats ---

// GET /gmail/stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  const total = await GmailMessage.countDocuments({ userId: req.userId });
  const unread = await GmailMessage.countDocuments({ userId: req.userId, isRead: false, archived: { $ne: true } });
  const inbox = await GmailMessage.countDocuments({ userId: req.userId, archived: { $ne: true } });
  const archived = await GmailMessage.countDocuments({ userId: req.userId, archived: true });

  res.json({ total, unread, inbox, archived });
});

export default router;
