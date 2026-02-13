import { Router, Response } from 'express';
import { z } from 'zod';
import { UserLog } from '../models/UserLog.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { upsertDoc, deleteDoc, deleteByKind } from '../services/vectorStore.js';
import { getQdrantUrl } from '../services/config.js';

const router = Router();
router.use(authMiddleware);

const createLogSchema = z.object({
  content: z.string().min(1).max(10000),
});

const updateLogSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
});

function indexLog(log: { _id: unknown; content?: string }) {
  if (!getQdrantUrl()) return;
  const text = (log.content || '').replace(/\n/g, ' ').trim();
  if (!text) return;
  upsertDoc({ kind: 'userLog', id: String(log._id), text }).catch(() => {});
}

function removeLogIndex(logId: string) {
  if (!getQdrantUrl()) return;
  deleteDoc('userLog', logId).catch(() => {});
}

// GET /user-logs
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { limit } = req.query;
    const max = limit ? Math.min(Number(limit), 500) : 100;
    const logs = await UserLog.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(max);
    res.json({ logs });
  } catch (error) {
    console.error('Get user logs error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /user-logs
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createLogSchema.parse(req.body);
    const content = data.content.replace(/\n/g, ' ').trim();
    const log = new UserLog({ content, userId: req.userId });
    await log.save();

    indexLog(log);

    const io = req.app.get('io');
    if (io) io.to('userLogs').emit('userLog:created', { log });

    res.status(201).json({ log });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create user log error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /user-logs/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateLogSchema.parse(req.body);
    const log = await UserLog.findOne({ _id: req.params.id, userId: req.userId });
    if (!log) { res.status(404).json({ error: 'Log non trouvé' }); return; }

    if (data.content) log.content = data.content.replace(/\n/g, ' ').trim();
    await log.save();

    indexLog(log);

    res.json({ log });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update user log error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /user-logs/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const log = await UserLog.findOne({ _id: req.params.id, userId: req.userId });
    if (!log) { res.status(404).json({ error: 'Log non trouvé' }); return; }

    await UserLog.findByIdAndDelete(req.params.id);
    removeLogIndex(req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete user log error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// DELETE /user-logs — clear all
router.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await UserLog.deleteMany({ userId: req.userId });
    if (getQdrantUrl()) deleteByKind('userLog').catch(() => {});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    console.error('Clear user logs error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
