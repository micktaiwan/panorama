import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';

import { connectDB } from './config/db.js';
import { setupSocket } from './socket/index.js';
import { authRoutes, projectsRoutes, tasksRoutes, notesRoutes, overviewRoutes, searchRoutes, peopleRoutes, teamsRoutes, linksRoutes, filesRoutes, alarmsRoutes, budgetRoutes, calendarRoutes, situationsRoutes, userLogsRoutes, mcpServersRoutes, notionRoutes, gmailRoutes, dataTransferRoutes, claudeRoutes } from './routes/index.js';
import { initProcessManager } from './services/claudeProcessManager.js';

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
}));

// Routes
app.use('/auth', authRoutes);
app.use('/projects', projectsRoutes);
app.use('/tasks', tasksRoutes);
app.use('/notes', notesRoutes);
app.use('/overview', overviewRoutes);
app.use('/search', searchRoutes);
app.use('/people', peopleRoutes);
app.use('/teams', teamsRoutes);
app.use('/links', linksRoutes);
app.use('/files', filesRoutes);
app.use('/alarms', alarmsRoutes);
app.use('/budget', budgetRoutes);
app.use('/calendar', calendarRoutes);
app.use('/situations', situationsRoutes);
app.use('/user-logs', userLogsRoutes);
app.use('/mcp-servers', mcpServersRoutes);
app.use('/notion', notionRoutes);
app.use('/gmail', gmailRoutes);
app.use('/data', dataTransferRoutes);
app.use('/claude', claudeRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Setup Socket.io
const io = setupSocket(httpServer);
app.set('io', io);
initProcessManager(io);

// Start server
const PORT = process.env.PORT || 3001;

function ensureUploadDirectories() {
  const dirs = ['images', 'files', 'videos'];
  for (const dir of dirs) {
    const fullPath = path.join(process.cwd(), 'public', 'uploads', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`✓ Created ${dir} upload directory`);
    }
  }
}

async function start() {
  try {
    ensureUploadDirectories();
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log(`Panoramix API running on http://localhost:${PORT}`);
      console.log(`Socket.io ready`);

      const shutdown = () => {
        console.log('Shutting down...');
        httpServer.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
