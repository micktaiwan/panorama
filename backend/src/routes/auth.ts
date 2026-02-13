import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User } from '../models/index.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().min(1).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// POST /auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await User.findOne({
      $or: [
        { username: data.username.toLowerCase() },
        { email: data.email.toLowerCase() },
      ],
    });

    if (existingUser) {
      const field = existingUser.username === data.username.toLowerCase() ? 'username' : 'email';
      res.status(400).json({ error: `Ce ${field} est déjà utilisé` });
      return;
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    // First user is admin
    const userCount = await User.countDocuments();
    const isFirstUser = userCount === 0;

    const user = new User({
      username: data.username.toLowerCase(),
      displayName: data.displayName,
      email: data.email.toLowerCase(),
      passwordHash,
      isAdmin: isFirstUser,
    });

    await user.save();

    const token = generateToken(user._id.toString(), user.username);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Register error:', error);
    res.status(500).json({ error: "Erreur lors de l'inscription" });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = loginSchema.parse(req.body);

    const identifier = data.username.toLowerCase();
    const user = await User.findOne(
      identifier.includes('@') ? { email: identifier } : { username: identifier }
    );

    if (!user) {
      res.status(401).json({ error: 'Utilisateur non trouvé' });
      return;
    }

    const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);

    if (!isValidPassword) {
      res.status(401).json({ error: 'Mot de passe incorrect' });
      return;
    }

    user.lastSeen = new Date();
    await user.save();

    const token = generateToken(user._id.toString(), user.username);

    console.log(`[AUTH] Login successful: user "${data.username}"`);

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Données invalides', details: error.issues });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// GET /auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({
      user: {
        id: req.user!._id,
        username: req.user!.username,
        displayName: req.user!.displayName,
        email: req.user!.email,
        isAdmin: req.user!.isAdmin,
        isOnline: req.user!.isOnline,
        lastSeen: req.user!.lastSeen,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
