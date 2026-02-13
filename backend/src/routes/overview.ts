import { Router, Response } from 'express';
import { Project, Task, Note } from '../models/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /overview — Dashboard summary
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    const [
      projectsTotal,
      projectsActive,
      tasksTotal,
      tasksTodo,
      tasksInProgress,
      tasksDone,
      tasksUrgent,
      tasksWithDeadline,
      notesTotal,
      recentProjects,
      recentTasks,
    ] = await Promise.all([
      Project.countDocuments({ userId }),
      Project.countDocuments({ userId, status: 'active' }),
      Task.countDocuments({ userId }),
      Task.countDocuments({ userId, status: 'todo' }),
      Task.countDocuments({ userId, status: 'in_progress' }),
      Task.countDocuments({ userId, status: 'done' }),
      Task.countDocuments({ userId, urgent: true, status: { $nin: ['done', 'cancelled'] } }),
      Task.countDocuments({ userId, deadline: { $ne: null }, status: { $nin: ['done', 'cancelled'] } }),
      Note.countDocuments({ userId }),
      Project.find({ userId, status: 'active' }).sort({ updatedAt: -1 }).limit(5).select('name status updatedAt isFavorite'),
      Task.find({ userId, status: { $nin: ['done', 'cancelled'] } }).sort({ urgent: -1, important: -1, updatedAt: -1 }).limit(10).select('title status urgent important deadline projectId'),
    ]);

    res.json({
      projects: {
        total: projectsTotal,
        active: projectsActive,
        recent: recentProjects,
      },
      tasks: {
        total: tasksTotal,
        todo: tasksTodo,
        inProgress: tasksInProgress,
        done: tasksDone,
        urgent: tasksUrgent,
        withDeadline: tasksWithDeadline,
        recent: recentTasks,
      },
      notes: {
        total: notesTotal,
      },
    });
  } catch (error) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
