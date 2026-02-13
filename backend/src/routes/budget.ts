import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { BudgetLine, computeDedupeHash } from '../models/BudgetLine.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

const createLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendor: z.string().min(1).max(500),
  category: z.string().max(200).default(''),
  amountCents: z.number().int(),
  vatCents: z.number().int().default(0),
  currency: z.string().max(10).default('EUR'),
  projectId: z.string().nullable().default(null),
  invoiceNumber: z.string().max(100).default(''),
  notes: z.string().max(5000).default(''),
  department: z.enum(['tech', 'parked', 'product', 'other', '']).default(''),
  team: z.enum(['lemapp', 'sre', 'data', 'pony', 'cto', '']).default(''),
});

const updateLineSchema = z.object({
  category: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  department: z.enum(['tech', 'parked', 'product', 'other', '']).optional(),
  team: z.enum(['lemapp', 'sre', 'data', 'pony', 'cto', '']).optional(),
  projectId: z.string().nullable().optional(),
  vendor: z.string().min(1).max(500).optional(),
});

// GET /budget — list with filters
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { from, to, department, team, vendor, projectId, importBatch } = req.query;
    const filter: Record<string, unknown> = { userId: req.userId };

    if (from && typeof from === 'string') filter.date = { ...((filter.date as object) || {}), $gte: from };
    if (to && typeof to === 'string') filter.date = { ...((filter.date as object) || {}), $lte: to };
    if (department && typeof department === 'string') filter.department = department;
    if (team && typeof team === 'string') filter.team = team;
    if (vendor && typeof vendor === 'string') filter.vendor = { $regex: vendor, $options: 'i' };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;
    if (importBatch && typeof importBatch === 'string') filter.importBatch = importBatch;

    const lines = await BudgetLine.find(filter).sort({ date: -1, vendor: 1 }).limit(500);
    res.json({ lines });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /budget/summary — aggregate by month/department
router.get('/summary', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query;
    const match: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(req.userId) };
    if (from && typeof from === 'string') match.date = { ...((match.date as object) || {}), $gte: from };
    if (to && typeof to === 'string') match.date = { ...((match.date as object) || {}), $lte: to };

    const summary = await BudgetLine.aggregate([
      { $match: match },
      {
        $group: {
          _id: { month: { $substr: ['$date', 0, 7] }, department: '$department' },
          totalCents: { $sum: '$amountCents' },
          vatCents: { $sum: '$vatCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.month': -1 } },
    ]);

    res.json({ summary });
  } catch (error) {
    console.error('Budget summary error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /budget/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const line = await BudgetLine.findOne({ _id: req.params.id, userId: req.userId });
    if (!line) { res.status(404).json({ error: 'Ligne non trouvée' }); return; }
    res.json({ line });
  } catch (error) {
    console.error('Get budget line error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /budget
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createLineSchema.parse(req.body);
    const dedupeHash = computeDedupeHash(data);

    const line = new BudgetLine({
      ...data,
      dedupeHash,
      userId: req.userId,
    });
    await line.save();

    const io = req.app.get('io');
    if (io) io.to('budget').emit('budget:created', { line });

    res.status(201).json({ line });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create budget line error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// POST /budget/import — bulk import
router.post('/import', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lines, importFile } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: 'lines requis (tableau non vide)' });
      return;
    }

    const importBatch = crypto.randomUUID();
    const importedAt = new Date();
    let imported = 0;
    let skipped = 0;

    for (const raw of lines) {
      const data = createLineSchema.safeParse(raw);
      if (!data.success) { skipped++; continue; }

      const dedupeHash = computeDedupeHash(data.data);
      const existing = await BudgetLine.findOne({ dedupeHash, userId: req.userId });
      if (existing) { skipped++; continue; }

      await new BudgetLine({
        ...data.data,
        dedupeHash,
        importBatch,
        importFile: importFile || '',
        importedAt,
        userId: req.userId,
      }).save();
      imported++;
    }

    const io = req.app.get('io');
    if (io) io.to('budget').emit('budget:imported', { imported, skipped, importBatch });

    res.json({ imported, skipped, importBatch });
  } catch (error) {
    console.error('Import budget error:', error);
    res.status(500).json({ error: 'Erreur lors de l\'import' });
  }
});

// PUT /budget/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateLineSchema.parse(req.body);
    const line = await BudgetLine.findOne({ _id: req.params.id, userId: req.userId });
    if (!line) { res.status(404).json({ error: 'Ligne non trouvée' }); return; }

    Object.assign(line, data);
    await line.save();

    const io = req.app.get('io');
    if (io) io.to('budget').emit('budget:updated', { line });

    res.json({ line });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update budget line error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// PUT /budget/:id/department — set department (bulk for same vendor)
router.put('/:id/department', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { department } = req.body;
    if (!['tech', 'parked', 'product', 'other', ''].includes(department)) {
      res.status(400).json({ error: 'department invalide' }); return;
    }

    const line = await BudgetLine.findOne({ _id: req.params.id, userId: req.userId });
    if (!line) { res.status(404).json({ error: 'Ligne non trouvée' }); return; }

    const bulkResult = await BudgetLine.updateMany(
      { vendor: line.vendor, userId: req.userId },
      { $set: { department } }
    );

    res.json({ ok: true, bulkUpdated: bulkResult.modifiedCount });
  } catch (error) {
    console.error('Set department error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /budget/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const line = await BudgetLine.findOne({ _id: req.params.id, userId: req.userId });
    if (!line) { res.status(404).json({ error: 'Ligne non trouvée' }); return; }

    await BudgetLine.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('budget').emit('budget:deleted', { lineId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete budget line error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
