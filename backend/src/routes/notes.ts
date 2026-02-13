import { Router, Response } from 'express';
import { z } from 'zod';
import { Note, NoteSession, NoteLine } from '../models/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { indexNote, removeNote } from '../services/vectorIndex.js';

const router = Router();
router.use(authMiddleware);

// ===== Notes =====

const createNoteSchema = z.object({
  projectId: z.string().nullable().default(null),
  title: z.string().max(500).default(''),
  content: z.string().max(100000).default(''),
});

const updateNoteSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().max(500).optional(),
  content: z.string().max(100000).optional(),
});

// GET /notes
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;

    const notes = await Note.find(filter).sort({ updatedAt: -1 });
    res.json({ notes });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /notes/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });

    if (!note) {
      res.status(404).json({ error: 'Note non trouvée' });
      return;
    }

    res.json({ note });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /notes
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createNoteSchema.parse(req.body);

    const note = new Note({
      ...data,
      userId: req.userId,
    });

    await note.save();

    indexNote(note);

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('note:created', { note });
    }

    res.status(201).json({ note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// PUT /notes/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateNoteSchema.parse(req.body);

    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });
    if (!note) {
      res.status(404).json({ error: 'Note non trouvée' });
      return;
    }

    Object.assign(note, data);
    await note.save();

    indexNote(note);

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('note:updated', { note });
    }

    res.json({ note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /notes/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });
    if (!note) {
      res.status(404).json({ error: 'Note non trouvée' });
      return;
    }

    await Note.findByIdAndDelete(req.params.id);

    removeNote(req.params.id);

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('note:deleted', { noteId: req.params.id });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ===== Note Sessions =====

// GET /notes/sessions
router.get('/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;

    const sessions = await NoteSession.find(filter).sort({ createdAt: -1 });
    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /notes/sessions
router.post('/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.body;

    const session = new NoteSession({
      userId: req.userId,
      projectId: projectId || null,
    });

    await session.save();

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('noteSession:created', { session });
    }

    res.status(201).json({ session });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

// DELETE /notes/sessions/:id
router.delete('/sessions/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await NoteSession.findOne({ _id: req.params.id, userId: req.userId });
    if (!session) {
      res.status(404).json({ error: 'Session non trouvée' });
      return;
    }

    await NoteLine.deleteMany({ sessionId: session._id });
    await NoteSession.findByIdAndDelete(session._id);

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('noteSession:deleted', { sessionId: req.params.id });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// ===== Note Lines =====

// GET /notes/sessions/:sessionId/lines
router.get('/sessions/:sessionId/lines', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lines = await NoteLine.find({
      sessionId: req.params.sessionId,
      userId: req.userId,
    }).sort({ createdAt: 1 });

    res.json({ lines });
  } catch (error) {
    console.error('Get lines error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /notes/sessions/:sessionId/lines
router.post('/sessions/:sessionId/lines', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content } = req.body;

    const session = await NoteSession.findOne({ _id: req.params.sessionId, userId: req.userId });
    if (!session) {
      res.status(404).json({ error: 'Session non trouvée' });
      return;
    }

    const line = new NoteLine({
      userId: req.userId,
      sessionId: session._id,
      content: content || '',
    });

    await line.save();

    const io = req.app.get('io');
    if (io) {
      io.to('notes').emit('noteLine:created', { line });
    }

    res.status(201).json({ line });
  } catch (error) {
    console.error('Create line error:', error);
    res.status(500).json({ error: 'Erreur lors de la création' });
  }
});

export default router;
