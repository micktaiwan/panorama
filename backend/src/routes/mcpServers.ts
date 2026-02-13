import { Router, Response } from 'express';
import { z } from 'zod';
import { MCPServer } from '../models/MCPServer.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['stdio', 'http']),
  enabled: z.boolean().default(true),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['stdio', 'http']).optional(),
  enabled: z.boolean().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

// GET /mcp-servers
router.get('/', async (req: AuthRequest, res: Response) => {
  const servers = await MCPServer.find({ userId: req.userId }).sort({ name: 1 });
  res.json(servers);
});

// GET /mcp-servers/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const server = await MCPServer.findOne({ _id: req.params.id, userId: req.userId });
  if (!server) { res.status(404).json({ error: 'Serveur MCP non trouvé' }); return; }
  res.json(server);
});

// POST /mcp-servers
router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const data = parsed.data;

  // Validate type-specific fields
  if (data.type === 'stdio' && !data.command) {
    res.status(400).json({ error: 'command est requis pour le type stdio' }); return;
  }
  if (data.type === 'http' && !data.url) {
    res.status(400).json({ error: 'url est requis pour le type http' }); return;
  }

  const server = await MCPServer.create({ ...data, userId: req.userId });
  req.app.get('io')?.to(`user:${req.userId}`).emit('mcpServer:created', server);
  res.status(201).json(server);
});

// PUT /mcp-servers/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const server = await MCPServer.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: parsed.data },
    { new: true },
  );
  if (!server) { res.status(404).json({ error: 'Serveur MCP non trouvé' }); return; }

  req.app.get('io')?.to(`user:${req.userId}`).emit('mcpServer:updated', server);
  res.json(server);
});

// DELETE /mcp-servers/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const server = await MCPServer.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!server) { res.status(404).json({ error: 'Serveur MCP non trouvé' }); return; }

  req.app.get('io')?.to(`user:${req.userId}`).emit('mcpServer:deleted', { _id: req.params.id });
  res.json({ ok: true });
});

// POST /mcp-servers/:id/test — Test connection (list tools)
router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  const server = await MCPServer.findOne({ _id: req.params.id, userId: req.userId });
  if (!server) { res.status(404).json({ error: 'Serveur MCP non trouvé' }); return; }

  try {
    // For HTTP servers, do a simple health check
    if (server.type === 'http' && server.url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(server.headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'panoramix', version: '0.1.0' },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const result = await response.json() as any;

      await MCPServer.updateOne(
        { _id: server._id },
        { $set: { lastConnectedAt: new Date(), lastError: null } },
      );

      res.json({ ok: true, type: 'http', result });
      return;
    }

    // For stdio servers, we'd need to spawn a process — mark as untested
    if (server.type === 'stdio') {
      res.json({
        ok: true,
        type: 'stdio',
        message: 'Les serveurs stdio nécessitent un test depuis le client desktop (Tauri)',
      });
      return;
    }

    res.status(400).json({ error: 'Type de serveur non supporté pour le test' });
  } catch (err: any) {
    const errorMsg = err.name === 'AbortError' ? 'Timeout (10s)' : err.message;
    await MCPServer.updateOne(
      { _id: server._id },
      { $set: { lastError: errorMsg } },
    );
    res.status(502).json({ error: errorMsg });
  }
});

// POST /mcp-servers/:id/call — Call a tool on a server
router.post('/:id/call', async (req: AuthRequest, res: Response) => {
  const server = await MCPServer.findOne({ _id: req.params.id, userId: req.userId });
  if (!server) { res.status(404).json({ error: 'Serveur MCP non trouvé' }); return; }

  const { toolName, args } = req.body;
  if (!toolName) { res.status(400).json({ error: 'toolName requis' }); return; }

  if (server.type !== 'http' || !server.url) {
    res.status(400).json({ error: 'Seuls les serveurs HTTP supportent les appels directs depuis le backend' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(server.headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const result = await response.json() as any;
    res.json(result);
  } catch (err: any) {
    const errorMsg = err.name === 'AbortError' ? 'Timeout (30s)' : err.message;
    res.status(502).json({ error: errorMsg });
  }
});

export default router;
