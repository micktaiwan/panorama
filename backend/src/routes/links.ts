import { Router, Response } from 'express';
import { z } from 'zod';
import { Link } from '../models/Link.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { indexLink, removeLink } from '../services/vectorIndex.js';

const router = Router();
router.use(authMiddleware);

const createLinkSchema = z.object({
  projectId: z.string().nullable().default(null),
  name: z.string().min(1).max(500),
  url: z.string().min(1).max(2000),
});

const updateLinkSchema = z.object({
  projectId: z.string().nullable().optional(),
  name: z.string().min(1).max(500).optional(),
  url: z.string().min(1).max(2000).optional(),
});

// GET /links
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;

    const links = await Link.find(filter).sort({ updatedAt: -1 });
    res.json({ links });
  } catch (error) {
    console.error('Get links error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /links/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const link = await Link.findOne({ _id: req.params.id, userId: req.userId });
    if (!link) { res.status(404).json({ error: 'Lien non trouvé' }); return; }
    res.json({ link });
  } catch (error) {
    console.error('Get link error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /links
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createLinkSchema.parse(req.body);
    const link = new Link({ ...data, userId: req.userId });
    await link.save();

    indexLink(link);

    const io = req.app.get('io');
    if (io) io.to('links').emit('link:created', { link });

    res.status(201).json({ link });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create link error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /links/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateLinkSchema.parse(req.body);
    const link = await Link.findOne({ _id: req.params.id, userId: req.userId });
    if (!link) { res.status(404).json({ error: 'Lien non trouvé' }); return; }

    Object.assign(link, data);
    await link.save();

    indexLink(link);

    const io = req.app.get('io');
    if (io) io.to('links').emit('link:updated', { link });

    res.json({ link });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update link error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /links/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const link = await Link.findOne({ _id: req.params.id, userId: req.userId });
    if (!link) { res.status(404).json({ error: 'Lien non trouvé' }); return; }

    await Link.findByIdAndDelete(req.params.id);
    removeLink(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('links').emit('link:deleted', { linkId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete link error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// POST /links/:id/click — register click
router.post('/:id/click', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const link = await Link.findOne({ _id: req.params.id, userId: req.userId });
    if (!link) { res.status(404).json({ error: 'Lien non trouvé' }); return; }

    link.clicksCount = (link.clicksCount || 0) + 1;
    link.lastClickedAt = new Date();
    await link.save();

    res.json({ link });
  } catch (error) {
    console.error('Register click error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
