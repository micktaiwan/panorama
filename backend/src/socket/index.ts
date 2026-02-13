import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { JwtPayload } from '../middleware/auth.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

export function setupSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
    },
  });

  // Auth middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Token manquant'));
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return next(new Error('Configuration serveur invalide'));
      }

      const decoded = jwt.verify(token, secret) as JwtPayload;
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    console.log(`User connected: ${socket.username} (${userId})`);

    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    // Join personal room for targeted events
    socket.join(`user:${userId}`);

    // Subscribe to data channels
    socket.on('subscribe:projects', () => socket.join('projects'));
    socket.on('unsubscribe:projects', () => socket.leave('projects'));
    socket.on('subscribe:tasks', () => socket.join('tasks'));
    socket.on('unsubscribe:tasks', () => socket.leave('tasks'));
    socket.on('subscribe:notes', () => socket.join('notes'));
    socket.on('unsubscribe:notes', () => socket.leave('notes'));

    // Claude Code rooms
    socket.on('subscribe:claude', () => socket.join('claude'));
    socket.on('unsubscribe:claude', () => socket.leave('claude'));
    socket.on('subscribe:claude:session', (sessionId: string) => {
      console.log(`[socket] ${socket.username} joined claude:session:${sessionId}`);
      socket.join(`claude:session:${sessionId}`);
    });
    socket.on('unsubscribe:claude:session', (sessionId: string) => socket.leave(`claude:session:${sessionId}`));
    socket.on('subscribe:claude:project', (projectId: string) => {
      console.log(`[socket] ${socket.username} joined claude:project:${projectId}`);
      socket.join(`claude:project:${projectId}`);
    });
    socket.on('unsubscribe:claude:project', (projectId: string) => socket.leave(`claude:project:${projectId}`));

    socket.broadcast.emit('user:online', { userId });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.username}`);

      const allSockets = await io.fetchSockets();
      const hasOtherSockets = allSockets.some(
        s => (s as any).userId === userId && s.id !== socket.id
      );

      if (!hasOtherSockets) {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
        socket.broadcast.emit('user:offline', { userId });
      }
    });
  });

  return io;
}
