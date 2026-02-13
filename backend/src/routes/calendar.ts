import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { CalendarEvent } from '../models/CalendarEvent.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const createEventSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(''),
  location: z.string().max(500).default(''),
  start: z.string().datetime(),
  end: z.string().datetime(),
  allDay: z.boolean().default(false),
  source: z.enum(['ics', 'google', 'manual']).default('manual'),
});

const updateEventSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  location: z.string().max(500).optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
});

// GET /calendar — list events in range
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query;
    const filter: Record<string, unknown> = { userId: req.userId };

    if (from && typeof from === 'string') {
      filter.end = { $gte: new Date(from) };
    }
    if (to && typeof to === 'string') {
      filter.start = { $lte: new Date(to) };
    }

    const events = await CalendarEvent.find(filter).sort({ start: 1 }).limit(500);
    res.json({ events });
  } catch (error) {
    console.error('Get calendar error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /calendar/today — today's events
router.get('/today', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const events = await CalendarEvent.find({
      userId: req.userId,
      start: { $lt: endOfDay },
      end: { $gt: startOfDay },
    }).sort({ start: 1 });

    res.json({ events });
  } catch (error) {
    console.error('Get today events error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /calendar/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.params.id, userId: req.userId });
    if (!event) { res.status(404).json({ error: 'Événement non trouvé' }); return; }
    res.json({ event });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /calendar
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createEventSchema.parse(req.body);
    const event = new CalendarEvent({
      ...data,
      uid: crypto.randomUUID(),
      start: new Date(data.start),
      end: new Date(data.end),
      userId: req.userId,
    });
    await event.save();

    const io = req.app.get('io');
    if (io) io.to('calendar').emit('calendar:created', { event });

    res.status(201).json({ event });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /calendar/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateEventSchema.parse(req.body);
    const event = await CalendarEvent.findOne({ _id: req.params.id, userId: req.userId });
    if (!event) { res.status(404).json({ error: 'Événement non trouvé' }); return; }

    const updateData: Record<string, unknown> = { ...data };
    if (data.start) updateData.start = new Date(data.start);
    if (data.end) updateData.end = new Date(data.end);

    Object.assign(event, updateData);
    await event.save();

    const io = req.app.get('io');
    if (io) io.to('calendar').emit('calendar:updated', { event });

    res.json({ event });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /calendar/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.params.id, userId: req.userId });
    if (!event) { res.status(404).json({ error: 'Événement non trouvé' }); return; }

    await CalendarEvent.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('calendar').emit('calendar:deleted', { eventId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
