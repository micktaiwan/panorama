import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { search, getCollectionInfo } from '../services/vectorStore.js';
import { getHealthStatus, getCurrentConfig } from '../services/llmProxy.js';
import { getQdrantUrl } from '../services/config.js';

const router = Router();
router.use(authMiddleware);

// GET /search?q=...&kind=...&projectId=...&limit=20
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      res.status(400).json({ error: 'Paramètre q requis' });
      return;
    }

    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;

    const results = await search(q.trim(), { kind, projectId, limit });

    res.json({ query: q.trim(), results, count: results.length });
  } catch (error) {
    console.error('Search error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur recherche';
    res.status(500).json({ error: msg });
  }
});

// GET /search/ai-status — AI provider health + config
router.get('/ai-status', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = getCurrentConfig();
    const qdrantUrl = getQdrantUrl();

    let qdrantOk = false;
    if (qdrantUrl) {
      try {
        const r = await fetch(`${qdrantUrl.replace(/\/$/, '')}/collections`);
        qdrantOk = r.ok;
      } catch { /* ignore */ }
    }

    let health;
    try {
      health = await getHealthStatus();
    } catch {
      health = { local: { ok: false }, remote: { ok: false } };
    }

    res.json({
      mode: config.mode,
      providers: health,
      qdrant: { url: qdrantUrl, ok: qdrantOk },
      models: {
        local: { chat: config.local.chatModel, embedding: config.local.embeddingModel },
        remote: { chat: config.remote.chatModel, embedding: config.remote.embeddingModel },
      },
    });
  } catch (error) {
    console.error('AI status error:', error);
    res.status(500).json({ error: 'Erreur statut AI' });
  }
});

// GET /search/collection-info — Qdrant collection details
router.get('/collection-info', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const info = await getCollectionInfo();
    res.json(info);
  } catch (error) {
    console.error('Collection info error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur Qdrant';
    res.status(500).json({ error: msg });
  }
});

export default router;
