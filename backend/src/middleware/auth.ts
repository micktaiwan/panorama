import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/index.js';

export interface JwtPayload {
  userId: string;
  username: string;
}

export interface AuthRequest extends Request {
  user?: IUser;
  userId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Dev mode: skip auth for local testing (NEVER in production)
    if (process.env.DEV_SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
      let devUser = await User.findOne().select('-passwordHash');
      if (!devUser) {
        devUser = await User.create({
          username: 'dev',
          displayName: 'Dev User',
          email: 'dev@localhost',
          passwordHash: 'not-a-real-hash',
          isAdmin: true,
        });
        console.log('[Auth] Created dev user for local testing');
      }
      req.user = devUser;
      req.userId = devUser._id.toString();
      next();
      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token manquant' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      res.status(500).json({ error: 'Configuration serveur invalide' });
      return;
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;
    const user = await User.findById(decoded.userId).select('-passwordHash');

    if (!user) {
      res.status(401).json({ error: 'Utilisateur non trouvé' });
      return;
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expiré' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Token invalide' });
      return;
    }
    res.status(500).json({ error: "Erreur d'authentification" });
  }
}

export function generateToken(userId: string, username: string): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET non défini');
  }

  return jwt.sign({ userId, username }, secret, { expiresIn: '7d' });
}

export async function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifié' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    return;
  }

  next();
}
