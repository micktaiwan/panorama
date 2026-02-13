import { Router, Response } from 'express';
import { z } from 'zod';
import { Team } from '../models/Team.js';
import { Person } from '../models/Person.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

// GET /teams
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const teams = await Team.find({ userId: req.userId }).sort({ name: 1 });
    res.json({ teams });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /teams/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) { res.status(404).json({ error: 'Équipe non trouvée' }); return; }
    res.json({ team });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /teams/:id/can-remove — check if team has members
router.get('/:id/can-remove', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) { res.status(404).json({ error: 'Équipe non trouvée' }); return; }

    const count = await Person.countDocuments({ teamId: team._id, userId: req.userId });
    res.json({ canRemove: count === 0, memberCount: count });
  } catch (error) {
    console.error('Can remove team error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /teams
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createTeamSchema.parse(req.body);
    const team = new Team({ ...data, userId: req.userId });
    await team.save();

    const io = req.app.get('io');
    if (io) io.to('teams').emit('team:created', { team });

    res.status(201).json({ team });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /teams/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateTeamSchema.parse(req.body);
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) { res.status(404).json({ error: 'Équipe non trouvée' }); return; }

    Object.assign(team, data);
    await team.save();

    const io = req.app.get('io');
    if (io) io.to('teams').emit('team:updated', { team });

    res.json({ team });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /teams/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) { res.status(404).json({ error: 'Équipe non trouvée' }); return; }

    const memberCount = await Person.countDocuments({ teamId: team._id, userId: req.userId });
    if (memberCount > 0) {
      res.status(400).json({ error: `Impossible de supprimer : ${memberCount} membre(s) dans cette équipe` });
      return;
    }

    await Team.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('teams').emit('team:deleted', { teamId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// POST /teams/:id/reassign — reassign members then delete
router.post('/:id/reassign', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const team = await Team.findOne({ _id: req.params.id, userId: req.userId });
    if (!team) { res.status(404).json({ error: 'Équipe non trouvée' }); return; }

    const { newTeamId } = req.body;

    if (newTeamId) {
      await Person.updateMany(
        { teamId: team._id, userId: req.userId },
        { $set: { teamId: newTeamId } }
      );
    } else {
      await Person.updateMany(
        { teamId: team._id, userId: req.userId },
        { $set: { teamId: null } }
      );
    }

    await Team.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) {
      io.to('teams').emit('team:deleted', { teamId: req.params.id });
      io.to('people').emit('people:reassigned', { oldTeamId: req.params.id, newTeamId: newTeamId || null });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reassign team error:', error);
    res.status(500).json({ error: 'Erreur lors de la réassignation' });
  }
});

export default router;
