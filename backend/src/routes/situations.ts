import { Router, Response } from 'express';
import { z } from 'zod';
import { Situation, SituationActor, SituationNote, SituationQuestion, SituationSummary } from '../models/Situation.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ===== Situations =====

const createSituationSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(''),
});

const updateSituationSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
});

// GET /situations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situations = await Situation.find({ userId: req.userId }).sort({ updatedAt: -1 });
    res.json({ situations });
  } catch (error) {
    console.error('Get situations error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /situations/:id — full detail with actors, notes, questions, summaries
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    const [actors, notes, questions, summaries] = await Promise.all([
      SituationActor.find({ situationId: situation._id }).sort({ name: 1 }),
      SituationNote.find({ situationId: situation._id }).sort({ createdAt: -1 }),
      SituationQuestion.find({ situationId: situation._id }).sort({ createdAt: -1 }),
      SituationSummary.find({ situationId: situation._id }).sort({ createdAt: -1 }),
    ]);

    res.json({ situation, actors, notes, questions, summaries });
  } catch (error) {
    console.error('Get situation error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /situations
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createSituationSchema.parse(req.body);
    const situation = new Situation({ ...data, userId: req.userId });
    await situation.save();

    const io = req.app.get('io');
    if (io) io.to('situations').emit('situation:created', { situation });

    res.status(201).json({ situation });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Create situation error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /situations/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateSituationSchema.parse(req.body);
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    Object.assign(situation, data);
    await situation.save();

    const io = req.app.get('io');
    if (io) io.to('situations').emit('situation:updated', { situation });

    res.json({ situation });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update situation error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /situations/:id — cascade delete all related
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    await Promise.all([
      SituationActor.deleteMany({ situationId: situation._id }),
      SituationNote.deleteMany({ situationId: situation._id }),
      SituationQuestion.deleteMany({ situationId: situation._id }),
      SituationSummary.deleteMany({ situationId: situation._id }),
    ]);
    await Situation.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('situations').emit('situation:deleted', { situationId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete situation error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ===== Actors =====

// POST /situations/:id/actors
router.post('/:id/actors', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    const { name, personId, role, situationRole } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'name requis' }); return; }

    const actor = new SituationActor({
      userId: req.userId,
      situationId: situation._id,
      personId: personId || null,
      name: name.trim(),
      role: role || '',
      situationRole: situationRole || '',
    });
    await actor.save();

    res.status(201).json({ actor });
  } catch (error) {
    console.error('Create actor error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// DELETE /situations/:sitId/actors/:actorId
router.delete('/:sitId/actors/:actorId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = await SituationActor.findOne({ _id: req.params.actorId, situationId: req.params.sitId, userId: req.userId });
    if (!actor) { res.status(404).json({ error: 'Acteur non trouvé' }); return; }

    await Promise.all([
      SituationNote.deleteMany({ actorId: actor._id }),
      SituationQuestion.deleteMany({ actorId: actor._id }),
    ]);
    await SituationActor.findByIdAndDelete(actor._id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete actor error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ===== Notes =====

// POST /situations/:id/notes
router.post('/:id/notes', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    const { content, actorId } = req.body;
    const note = new SituationNote({
      userId: req.userId,
      situationId: situation._id,
      actorId: actorId || null,
      content: content || '',
    });
    await note.save();

    res.status(201).json({ note });
  } catch (error) {
    console.error('Create situation note error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// DELETE /situations/:sitId/notes/:noteId
router.delete('/:sitId/notes/:noteId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await SituationNote.findOne({ _id: req.params.noteId, situationId: req.params.sitId, userId: req.userId });
    if (!note) { res.status(404).json({ error: 'Note non trouvée' }); return; }
    await SituationNote.findByIdAndDelete(note._id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete situation note error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ===== Summaries =====

// POST /situations/:id/summaries
router.post('/:id/summaries', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const situation = await Situation.findOne({ _id: req.params.id, userId: req.userId });
    if (!situation) { res.status(404).json({ error: 'Situation non trouvée' }); return; }

    const { text } = req.body;
    const summary = new SituationSummary({
      userId: req.userId,
      situationId: situation._id,
      text: text || '',
    });
    await summary.save();

    res.status(201).json({ summary });
  } catch (error) {
    console.error('Create summary error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

export default router;
