import { Router, Response } from 'express';
import { z } from 'zod';
import { Task } from '../models/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { indexTask, removeTask } from '../services/vectorIndex.js';

const router = Router();
router.use(authMiddleware);

const createTaskSchema = z.object({
  projectId: z.string().nullable().default(null),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(''),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).default('todo'),
  urgent: z.boolean().default(false),
  important: z.boolean().default(false),
  deadline: z.string().datetime().nullable().default(null),
  scheduledDate: z.string().datetime().nullable().default(null),
  estimate: z.number().nullable().default(null),
});

const updateTaskSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  urgent: z.boolean().optional(),
  important: z.boolean().optional(),
  deadline: z.string().datetime().nullable().optional(),
  scheduledDate: z.string().datetime().nullable().optional(),
  estimate: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  rank: z.number().optional(),
});

// GET /tasks
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, status, urgent, important } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;
    if (status && typeof status === 'string') filter.status = status;
    if (urgent === 'true') filter.urgent = true;
    if (important === 'true') filter.important = true;

    const tasks = await Task.find(filter).sort({ rank: 1, updatedAt: -1 });
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /tasks/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.userId });

    if (!task) {
      res.status(404).json({ error: 'Tâche non trouvée' });
      return;
    }

    res.json({ task });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /tasks
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createTaskSchema.parse(req.body);

    const task = new Task({
      ...data,
      deadline: data.deadline ? new Date(data.deadline) : null,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
      userId: req.userId,
    });

    await task.save();

    indexTask(task);

    const io = req.app.get('io');
    if (io) {
      io.to('tasks').emit('task:created', { task });
    }

    res.status(201).json({ task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /tasks/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateTaskSchema.parse(req.body);

    const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) {
      res.status(404).json({ error: 'Tâche non trouvée' });
      return;
    }

    // Track status changes
    if (data.status && data.status !== task.status) {
      task.statusChangedAt = new Date();
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.deadline !== undefined) {
      updateData.deadline = data.deadline ? new Date(data.deadline) : null;
    }
    if (data.scheduledDate !== undefined) {
      updateData.scheduledDate = data.scheduledDate ? new Date(data.scheduledDate) : null;
    }

    Object.assign(task, updateData);
    await task.save();

    indexTask(task);

    const io = req.app.get('io');
    if (io) {
      io.to('tasks').emit('task:updated', { task });
    }

    res.json({ task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /tasks/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) {
      res.status(404).json({ error: 'Tâche non trouvée' });
      return;
    }

    await Task.findByIdAndDelete(req.params.id);

    removeTask(req.params.id);

    const io = req.app.get('io');
    if (io) {
      io.to('tasks').emit('task:deleted', { taskId: req.params.id });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
