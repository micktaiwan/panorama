import { Router, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { FileDoc } from '../models/FileDoc.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// Multer config — store to public/uploads/files
const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'files');

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    const hash = crypto.randomBytes(16).toString('hex');
    cb(null, `${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

const updateFileSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  projectId: z.string().nullable().optional(),
});

// GET /files
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId } = req.query;

    const filter: Record<string, unknown> = { userId: req.userId };
    if (projectId && typeof projectId === 'string') filter.projectId = projectId;

    const files = await FileDoc.find(filter).sort({ updatedAt: -1 });
    res.json({ files });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /files/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = await FileDoc.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) { res.status(404).json({ error: 'Fichier non trouvé' }); return; }
    res.json({ file });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /files — upload
router.post('/', upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Aucun fichier fourni' }); return; }

    const fileDoc = new FileDoc({
      userId: req.userId,
      projectId: req.body.projectId || null,
      name: req.body.name || req.file.originalname,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });

    await fileDoc.save();

    const io = req.app.get('io');
    if (io) io.to('files').emit('file:created', { file: fileDoc });

    res.status(201).json({ file: fileDoc });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ error: 'Erreur lors de l\'upload' });
  }
});

// PUT /files/:id — update metadata
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateFileSchema.parse(req.body);
    const file = await FileDoc.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) { res.status(404).json({ error: 'Fichier non trouvé' }); return; }

    Object.assign(file, data);
    await file.save();

    const io = req.app.get('io');
    if (io) io.to('files').emit('file:updated', { file });

    res.json({ file });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Données invalides', details: error.issues }); return; }
    console.error('Update file error:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /files/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = await FileDoc.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) { res.status(404).json({ error: 'Fichier non trouvé' }); return; }

    // Delete physical file
    const filePath = path.join(uploadsDir, file.storedName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await FileDoc.findByIdAndDelete(req.params.id);

    const io = req.app.get('io');
    if (io) io.to('files').emit('file:deleted', { fileId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// POST /files/:id/click — register click
router.post('/:id/click', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = await FileDoc.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) { res.status(404).json({ error: 'Fichier non trouvé' }); return; }

    file.clicksCount = (file.clicksCount || 0) + 1;
    file.lastClickedAt = new Date();
    await file.save();

    res.json({ file });
  } catch (error) {
    console.error('Register click error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /files/:id/download — download file
router.get('/:id/download', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = await FileDoc.findOne({ _id: req.params.id, userId: req.userId });
    if (!file) { res.status(404).json({ error: 'Fichier non trouvé' }); return; }

    const filePath = path.join(uploadsDir, file.storedName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Fichier physique introuvable' });
      return;
    }

    res.download(filePath, file.originalName);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: 'Erreur lors du téléchargement' });
  }
});

export default router;
