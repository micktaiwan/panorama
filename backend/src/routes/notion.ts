import { Router, Response } from 'express';
import { z } from 'zod';
import { NotionIntegration, NotionTicket } from '../models/NotionIntegration.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// --- Integrations ---

const createIntegrationSchema = z.object({
  name: z.string().min(1).max(200),
  databaseId: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  filters: z.object({
    squadName: z.string().optional(),
    lifecycle: z.array(z.string()).optional(),
    ownerIds: z.array(z.string()).optional(),
  }).default({}),
  ownerMapping: z.record(z.string(), z.string()).optional(),
  pageSize: z.number().min(1).max(100).default(100),
  enabled: z.boolean().default(true),
});

const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  databaseId: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  filters: z.object({
    squadName: z.string().optional(),
    lifecycle: z.array(z.string()).optional(),
    ownerIds: z.array(z.string()).optional(),
  }).optional(),
  ownerMapping: z.record(z.string(), z.string()).optional(),
  pageSize: z.number().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

// GET /notion/integrations
router.get('/integrations', async (req: AuthRequest, res: Response) => {
  const integrations = await NotionIntegration.find({ userId: req.userId }).sort({ name: 1 });
  res.json(integrations);
});

// POST /notion/integrations
router.post('/integrations', async (req: AuthRequest, res: Response) => {
  const parsed = createIntegrationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const integration = await NotionIntegration.create({ ...parsed.data, userId: req.userId });
  req.app.get('io')?.to(`user:${req.userId}`).emit('notionIntegration:created', integration);
  res.status(201).json(integration);
});

// PUT /notion/integrations/:id
router.put('/integrations/:id', async (req: AuthRequest, res: Response) => {
  const parsed = updateIntegrationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const integration = await NotionIntegration.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: parsed.data },
    { new: true },
  );
  if (!integration) { res.status(404).json({ error: 'Intégration non trouvée' }); return; }

  req.app.get('io')?.to(`user:${req.userId}`).emit('notionIntegration:updated', integration);
  res.json(integration);
});

// DELETE /notion/integrations/:id — cascade delete tickets
router.delete('/integrations/:id', async (req: AuthRequest, res: Response) => {
  const integration = await NotionIntegration.findOneAndDelete(
    { _id: req.params.id, userId: req.userId },
  );
  if (!integration) { res.status(404).json({ error: 'Intégration non trouvée' }); return; }

  await NotionTicket.deleteMany({ integrationId: integration._id });

  req.app.get('io')?.to(`user:${req.userId}`).emit('notionIntegration:deleted', { _id: req.params.id });
  res.json({ ok: true });
});

// --- Tickets ---

// GET /notion/integrations/:id/tickets
router.get('/integrations/:id/tickets', async (req: AuthRequest, res: Response) => {
  const integration = await NotionIntegration.findOne({ _id: req.params.id, userId: req.userId });
  if (!integration) { res.status(404).json({ error: 'Intégration non trouvée' }); return; }

  const tickets = await NotionTicket.find({ integrationId: integration._id })
    .sort({ syncedAt: -1 })
    .limit(500);
  res.json(tickets);
});

// POST /notion/integrations/:id/sync — Sync from Notion API
router.post('/integrations/:id/sync', async (req: AuthRequest, res: Response) => {
  const integration = await NotionIntegration.findOne({ _id: req.params.id, userId: req.userId });
  if (!integration) { res.status(404).json({ error: 'Intégration non trouvée' }); return; }

  if (integration.syncInProgress) {
    res.status(409).json({ error: 'Synchronisation déjà en cours' }); return;
  }

  const notionApiKey = process.env.NOTION_API_KEY;
  if (!notionApiKey) {
    res.status(500).json({ error: 'NOTION_API_KEY non configurée' }); return;
  }

  // Mark sync in progress
  await NotionIntegration.updateOne(
    { _id: integration._id },
    { $set: { syncInProgress: true, syncProgress: { current: 0, pageCount: 0, status: 'starting' } } },
  );

  res.json({ ok: true, message: 'Synchronisation démarrée' });

  // Background sync
  syncNotionDatabase(integration, notionApiKey, req.userId!, req.app.get('io')).catch((err) => {
    console.error('[Notion] Sync error:', err);
  });
});

// POST /notion/integrations/:id/cancel-sync
router.post('/integrations/:id/cancel-sync', async (req: AuthRequest, res: Response) => {
  await NotionIntegration.updateOne(
    { _id: req.params.id, userId: req.userId },
    { $set: { syncInProgress: false, 'syncProgress.status': 'cancelled' } },
  );
  res.json({ ok: true });
});

// DELETE /notion/integrations/:id/tickets — Clear all tickets for an integration
router.delete('/integrations/:id/tickets', async (req: AuthRequest, res: Response) => {
  const integration = await NotionIntegration.findOne({ _id: req.params.id, userId: req.userId });
  if (!integration) { res.status(404).json({ error: 'Intégration non trouvée' }); return; }

  const result = await NotionTicket.deleteMany({ integrationId: integration._id });
  res.json({ ok: true, deleted: result.deletedCount });
});

// --- Background sync helper ---

async function syncNotionDatabase(
  integration: InstanceType<typeof NotionIntegration>,
  apiKey: string,
  userId: string,
  io: any,
) {
  let startCursor: string | undefined;
  let pageCount = 0;
  let totalImported = 0;

  try {
    do {
      // Check if cancelled
      const current = await NotionIntegration.findById(integration._id);
      if (!current || !current.syncInProgress) break;

      const body: any = { page_size: integration.pageSize || 100 };
      if (startCursor) body.start_cursor = startCursor;

      // Add filters if configured
      if (integration.filters?.lifecycle?.length) {
        body.filter = {
          or: integration.filters.lifecycle.map((val: string) => ({
            property: 'Lifecycle',
            status: { equals: val },
          })),
        };
      }

      const response = await fetch(
        `${NOTION_API_BASE}/databases/${integration.databaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_VERSION,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Notion API ${response.status}: ${err}`);
      }

      const data = await response.json() as any;
      pageCount++;

      // Process results
      const tickets = (data.results || []).map((page: any) => extractTicket(page, integration));

      // Bulk upsert
      for (const ticket of tickets) {
        await NotionTicket.findOneAndUpdate(
          { integrationId: integration._id, notionId: ticket.notionId },
          { $set: { ...ticket, userId, syncedAt: new Date() } },
          { upsert: true },
        );
        totalImported++;
      }

      // Update progress
      await NotionIntegration.updateOne(
        { _id: integration._id },
        { $set: { syncProgress: { current: totalImported, pageCount, status: 'syncing' } } },
      );

      io?.to(`user:${userId}`).emit('notionSync:progress', {
        integrationId: integration._id.toString(),
        current: totalImported,
        pageCount,
      });

      startCursor = data.has_more ? data.next_cursor : undefined;
    } while (startCursor);

    // Done
    await NotionIntegration.updateOne(
      { _id: integration._id },
      {
        $set: {
          syncInProgress: false,
          lastSyncAt: new Date(),
          syncProgress: { current: totalImported, pageCount, status: 'done' },
        },
      },
    );

    io?.to(`user:${userId}`).emit('notionSync:done', {
      integrationId: integration._id.toString(),
      total: totalImported,
    });
  } catch (err: any) {
    await NotionIntegration.updateOne(
      { _id: integration._id },
      {
        $set: {
          syncInProgress: false,
          syncProgress: { current: totalImported, pageCount, status: `error: ${err.message}` },
        },
      },
    );

    io?.to(`user:${userId}`).emit('notionSync:error', {
      integrationId: integration._id.toString(),
      error: err.message,
    });
  }
}

function extractTicket(page: any, integration: InstanceType<typeof NotionIntegration>) {
  const props = page.properties || {};

  const getTitle = (prop: any) => prop?.title?.map((t: any) => t.plain_text).join('') || '';
  const getRichText = (prop: any) => prop?.rich_text?.map((t: any) => t.plain_text).join('') || '';
  const getNumber = (prop: any) => prop?.number ?? undefined;
  const getStatus = (prop: any) => prop?.status?.name || '';
  const getSelect = (prop: any) => prop?.select?.name || '';
  const getPeople = (prop: any) =>
    (prop?.people || []).map((p: any) => ({
      id: p.id,
      name: integration.ownerMapping?.[p.id] || p.name || 'Unknown',
    }));

  return {
    notionId: page.id,
    ticketId: getNumber(props['ID']) || getNumber(props['id']),
    title: getTitle(props['Name']) || getTitle(props['Nom']) || getTitle(props['Title']),
    owners: getPeople(props['Owner']) || getPeople(props['Owners']) || getPeople(props['Assignee']),
    age: getRichText(props['Age']),
    priority: getSelect(props['Priority']) || getSelect(props['Priorité']),
    lifecycle: getStatus(props['Lifecycle']) || getStatus(props['Status']),
    nextStep: getRichText(props['Next Step']) || getRichText(props['Prochaine étape']),
    url: page.url || '',
  };
}

export default router;
