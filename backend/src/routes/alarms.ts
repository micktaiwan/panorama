import { Router, Response } from 'express';
import { z } from 'zod';
import { Alarm } from '../models/Alarm.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const recurrenceSchema = z.object({
  type: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
});

const createAlarmSchema = z.object({
  title: z.string().min(1).max(500),
  nextTriggerAt: z.string().datetime(),
  recurrence: recurrenceSchema.default({ type: 'none' }),
  enabled: z.boolean().default(true),
});

const updateAlarmSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  nextTriggerAt: z.string().datetime().optional(),
  recurrence: recurrenceSchema.optional(),
  enabled: z.boolean().optional(),
});

// Compute next occurrence for recurring alarms
function computeNextOccurrence(baseDate: Date, type: string, daysOfWeek?: number[]): Date {
  const next = new Date(baseDate);

  switch (type) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      if (daysOfWeek && daysOfWeek.length > 0) {
        const currentDay = next.getDay();
        const sorted = [...daysOfWeek].sort((a, b) => a - b);
        const nextDay = sorted.find(d => d > currentDay);
        if (nextDay !== undefined) {
          next.setDate(next.getDate() + (nextDay - currentDay));
        } else {
          next.setDate(next.getDate() + (7 - currentDay + sorted[0]));
        }
      } else {
        next.setDate(next.getDate() + 7);
      }
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      break;
  }

  return next;
}

// GET /alarms
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alarms = await Alarm.find({ userId: req.userId }).sort({ nextTriggerAt: 1 });
    res.json({ alarms });
  } catch (error) {
    console.error('Get alarms error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /alarms/due — get alarms that should fire now
router.get('/due', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const alarms = await Alarm.find({
      userId: req.userId,
      enabled: true,
      done: false,
      nextTriggerAt: { $lte: now },
      $or: [
        { snoozedUntilAt: null },
        { snoozedUntilAt: { $lte: now } },
      ],
    }).sort({ nextTriggerAt: 1 });
    res.json({ alarms });
  } catch (error) {
    console.error('Get due alarms error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /alarms/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alarm = await Alarm.findOne({ _id: req.params.id, userId: req.userId });
    if (!alarm) { res.status(404).json({ error: 'Alarme non trouvée' }); return; }
    res.json({ alarm });
  } catch (error) {
    console.error('Get alarm error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /alarms
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createAlarmSchema.parse(req.body);
    const alarm = new Alarm({
      ...data,
      nextTriggerAt: new Date(data.nextTriggerAt),
      userId: req.userId,
    });
    await alarm.save();

    const io = req.app.get('io');
    if (io) io.to('alarms').emit('alarm:created', { alarm });

    res.status(201).json({ alarm });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create alarm error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /alarms/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateAlarmSchema.parse(req.body);
    const alarm = await Alarm.findOne({ _id: req.params.id, userId: req.userId });
    if (!alarm) { res.status(404).json({ error: 'Alarme non trouvée' }); return; }

    const updateData: Record<string, unknown> = { ...data };
    if (data.nextTriggerAt) updateData.nextTriggerAt = new Date(data.nextTriggerAt);

    Object.assign(alarm, updateData);
    await alarm.save();

    const io = req.app.get('io');
    if (io) io.to('alarms').emit('alarm:updated', { alarm });

    res.json({ alarm });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update alarm error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /alarms/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alarm = await Alarm.findOne({ _id: req.params.id, userId: req.userId });
    if (!alarm) { res.status(404).json({ error: 'Alarme non trouvée' }); return; }

    await Alarm.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('alarms').emit('alarm:deleted', { alarmId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete alarm error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// POST /alarms/:id/snooze
router.post('/:id/snooze', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { minutes } = req.body;
    if (!minutes || typeof minutes !== 'number' || minutes < 1) {
      res.status(400).json({ error: 'minutes requis (nombre > 0)' });
      return;
    }

    const alarm = await Alarm.findOne({ _id: req.params.id, userId: req.userId });
    if (!alarm) { res.status(404).json({ error: 'Alarme non trouvée' }); return; }

    const now = new Date();
    const base = new Date(Math.max(
      alarm.snoozedUntilAt?.getTime() || 0,
      alarm.nextTriggerAt.getTime(),
      now.getTime()
    ));
    alarm.snoozedUntilAt = new Date(base.getTime() + minutes * 60 * 1000);
    await alarm.save();

    const io = req.app.get('io');
    if (io) io.to('alarms').emit('alarm:snoozed', { alarm });

    res.json({ alarm });
  } catch (error) {
    console.error('Snooze alarm error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /alarms/:id/dismiss
router.post('/:id/dismiss', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alarm = await Alarm.findOne({ _id: req.params.id, userId: req.userId });
    if (!alarm) { res.status(404).json({ error: 'Alarme non trouvée' }); return; }

    alarm.acknowledgedAt = new Date();
    alarm.lastFiredAt = new Date();
    alarm.snoozedUntilAt = null;

    if (alarm.recurrence.type !== 'none') {
      alarm.nextTriggerAt = computeNextOccurrence(
        alarm.nextTriggerAt,
        alarm.recurrence.type,
        alarm.recurrence.daysOfWeek
      );
      alarm.done = false;
    } else {
      alarm.done = true;
      alarm.enabled = false;
    }

    await alarm.save();

    const io = req.app.get('io');
    if (io) io.to('alarms').emit('alarm:dismissed', { alarm });

    res.json({ alarm });
  } catch (error) {
    console.error('Dismiss alarm error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
