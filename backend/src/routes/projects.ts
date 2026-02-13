import { Router, Response } from 'express';
import { z } from 'zod';
import { Project, Task, Note, NoteSession, NoteLine } from '../models/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { indexProject, removeProject, removeProjectCascade } from '../services/vectorIndex.js';

const router = Router();
router.use(authMiddleware);

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10000).default(''),
  status: z.enum(['active', 'paused', 'done', 'archived']).default('active'),
  targetDate: z.string().datetime().nullable().default(null),
  riskLevel: z.enum(['low', 'medium', 'high']).nullable().default(null),
  isFavorite: z.boolean().default(false),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
  targetDate: z.string().datetime().nullable().optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).nullable().optional(),
  isFavorite: z.boolean().optional(),
  rank: z.number().optional(),
});

// GET /projects
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, favorite } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (status && typeof status === 'string') filter.status = status;
    if (favorite === 'true') filter.isFavorite = true;

    const projects = await Project.find(filter).sort({ isFavorite: -1, rank: 1, updatedAt: -1 });
    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /projects/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.userId });

    if (!project) {
      res.status(404).json({ error: 'Projet non trouvé' });
      return;
    }

    res.json({ project });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /projects
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createProjectSchema.parse(req.body);

    const project = new Project({
      ...data,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      userId: req.userId,
    });

    await project.save();

    const io = req.app.get('io');
    if (io) {
      io.to('projects').emit('project:created', { project });
    }

    indexProject(project);

    res.status(201).json({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /projects/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateProjectSchema.parse(req.body);

    const project = await Project.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) {
      res.status(404).json({ error: 'Projet non trouvé' });
      return;
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.targetDate !== undefined) {
      updateData.targetDate = data.targetDate ? new Date(data.targetDate) : null;
    }

    Object.assign(project, updateData);
    await project.save();

    indexProject(project);

    const io = req.app.get('io');
    if (io) {
      io.to('projects').emit('project:updated', { project });
    }

    res.json({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /projects/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) {
      res.status(404).json({ error: 'Projet non trouvé' });
      return;
    }

    // Cascade: delete tasks, notes, sessions, lines associated with this project
    const projectId = project._id;
    const sessions = await NoteSession.find({ projectId });
    const sessionIds = sessions.map(s => s._id);

    await Promise.all([
      Task.deleteMany({ projectId }),
      Note.deleteMany({ projectId }),
      NoteLine.deleteMany({ sessionId: { $in: sessionIds } }),
      NoteSession.deleteMany({ projectId }),
    ]);

    await Project.findByIdAndDelete(projectId);

    removeProject(String(projectId));
    removeProjectCascade(String(projectId));

    const io = req.app.get('io');
    if (io) {
      io.to('projects').emit('project:deleted', { projectId: req.params.id });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

export default router;
