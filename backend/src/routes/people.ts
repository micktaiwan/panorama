import { Router, Response } from 'express';
import { z } from 'zod';
import { Person } from '../models/Person.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const createPersonSchema = z.object({
  name: z.string().min(1).max(200),
  lastName: z.string().max(200).default(''),
  aliases: z.array(z.string().max(100)).max(20).default([]),
  email: z.string().max(200).default(''),
  role: z.string().max(200).default(''),
  notes: z.string().max(10000).default(''),
  left: z.boolean().default(false),
  contactOnly: z.boolean().default(false),
  teamId: z.string().nullable().default(null),
  subteam: z.string().max(200).default(''),
  arrivalDate: z.string().datetime().nullable().default(null),
});

const updatePersonSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  lastName: z.string().max(200).optional(),
  aliases: z.array(z.string().max(100)).max(20).optional(),
  email: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  notes: z.string().max(10000).optional(),
  left: z.boolean().optional(),
  contactOnly: z.boolean().optional(),
  teamId: z.string().nullable().optional(),
  subteam: z.string().max(200).optional(),
  arrivalDate: z.string().datetime().nullable().optional(),
});

// GET /people
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { teamId, left, contactOnly, q } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (teamId && typeof teamId === 'string') filter.teamId = teamId;
    if (left === 'true') filter.left = true;
    if (left === 'false') filter.left = false;
    if (contactOnly === 'true') filter.contactOnly = true;

    // Text search on normalizedName
    if (q && typeof q === 'string') {
      const normalized = q.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      if (normalized) filter.normalizedName = { $regex: normalized, $options: 'i' };
    }

    const people = await Person.find(filter).sort({ name: 1, lastName: 1 });
    res.json({ people });
  } catch (error) {
    console.error('Get people error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /people/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const person = await Person.findOne({ _id: req.params.id, userId: req.userId });
    if (!person) { res.status(404).json({ error: 'Personne non trouvée' }); return; }
    res.json({ person });
  } catch (error) {
    console.error('Get person error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /people
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createPersonSchema.parse(req.body);
    const person = new Person({
      ...data,
      arrivalDate: data.arrivalDate ? new Date(data.arrivalDate) : null,
      userId: req.userId,
    });
    await person.save();

    const io = req.app.get('io');
    if (io) io.to('people').emit('person:created', { person });

    res.status(201).json({ person });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create person error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /people/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updatePersonSchema.parse(req.body);
    const person = await Person.findOne({ _id: req.params.id, userId: req.userId });
    if (!person) { res.status(404).json({ error: 'Personne non trouvée' }); return; }

    const updateData: Record<string, unknown> = { ...data };
    if (data.arrivalDate !== undefined) {
      updateData.arrivalDate = data.arrivalDate ? new Date(data.arrivalDate) : null;
    }

    Object.assign(person, updateData);
    await person.save();

    const io = req.app.get('io');
    if (io) io.to('people').emit('person:updated', { person });

    res.json({ person });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update person error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /people/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const person = await Person.findOne({ _id: req.params.id, userId: req.userId });
    if (!person) { res.status(404).json({ error: 'Personne non trouvée' }); return; }

    await Person.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('people').emit('person:deleted', { personId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete person error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
