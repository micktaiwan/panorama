import { Router, Response } from 'express';
import { ClaudeProject, ClaudeSession, ClaudeMessage } from '../models/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import {
  spawnClaudeProcess,
  killProcess,
  isRunning,
  queueMessage,
  dequeueMessage,
  clearQueue,
  respondToPermission,
  syncPermissionMode,
  execShellCommand,
  emitMessageCreated,
} from '../services/claudeProcessManager.js';
import os from 'os';

const router = Router();
router.use(authMiddleware);

// ==================== Projects ====================

// GET /claude/projects
router.get('/projects', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projects = await ClaudeProject.find({ userId: req.userId }).sort({ updatedAt: -1 });
    res.json({ projects });
  } catch (error) {
    console.error('Get claude projects error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/projects
router.post('/projects', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, cwd, model, permissionMode, appendSystemPrompt, linkedProjectId, claudeEffort, codexModel, codexReasoningEffort } = req.body;

    const project = await ClaudeProject.create({
      userId: req.userId,
      name: name || 'New Project',
      cwd: cwd || '',
      model: model || '',
      permissionMode: permissionMode || '',
      appendSystemPrompt: appendSystemPrompt || '',
      linkedProjectId: linkedProjectId || null,
      claudeEffort: claudeEffort || '',
      codexModel: codexModel || '',
      codexReasoningEffort: codexReasoningEffort || '',
    });

    // Auto-create first session
    await ClaudeSession.create({
      userId: req.userId,
      projectId: project._id,
      name: 'Session',
      cwd: cwd || '',
      model: model || '',
      permissionMode: permissionMode || '',
      appendSystemPrompt: appendSystemPrompt || '',
      claudeEffort: claudeEffort || '',
      codexModel: codexModel || '',
      codexReasoningEffort: codexReasoningEffort || '',
    });

    res.json({ project });
  } catch (error) {
    console.error('Create claude project error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /claude/projects/:id
router.put('/projects/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await ClaudeProject.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { new: true },
    );
    if (!project) { res.status(404).json({ error: 'Projet non trouvé' }); return; }
    res.json({ project });
  } catch (error) {
    console.error('Update claude project error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /claude/projects/:id
router.delete('/projects/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await ClaudeProject.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!project) { res.status(404).json({ error: 'Projet non trouvé' }); return; }

    // Cascade: kill processes, delete sessions and messages
    const sessions = await ClaudeSession.find({ projectId: req.params.id });
    for (const session of sessions) {
      if (isRunning(session._id.toString())) {
        await killProcess(session._id.toString());
      }
      await ClaudeMessage.deleteMany({ sessionId: session._id });
    }
    await ClaudeSession.deleteMany({ projectId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete claude project error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== Sessions ====================

// GET /claude/projects/:id/sessions
router.get('/projects/:id/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessions = await ClaudeSession.find({ projectId: req.params.id, userId: req.userId }).sort({ createdAt: 1 });
    res.json({ sessions });
  } catch (error) {
    console.error('Get claude sessions error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/projects/:id/sessions
router.post('/projects/:id/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await ClaudeProject.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) { res.status(404).json({ error: 'Projet non trouvé' }); return; }

    const session = await ClaudeSession.create({
      userId: req.userId,
      projectId: project._id,
      name: req.body.name || 'Session',
      cwd: req.body.cwd || project.cwd,
      model: req.body.model || project.model,
      permissionMode: req.body.permissionMode || project.permissionMode,
      appendSystemPrompt: req.body.appendSystemPrompt || project.appendSystemPrompt,
      claudeEffort: req.body.claudeEffort || project.claudeEffort,
      codexModel: req.body.codexModel || project.codexModel,
      codexReasoningEffort: req.body.codexReasoningEffort || project.codexReasoningEffort,
    });

    res.json({ session });
  } catch (error) {
    console.error('Create claude session error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /claude/sessions/:id
router.put('/sessions/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const oldSession = await ClaudeSession.findOne({ _id: req.params.id, userId: req.userId });
    if (!oldSession) { res.status(404).json({ error: 'Session non trouvée' }); return; }

    const session = await ClaudeSession.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true },
    );

    // If permission mode changed, sync pending permissions
    if (req.body.permissionMode && req.body.permissionMode !== oldSession.permissionMode) {
      await syncPermissionMode(req.params.id, req.body.permissionMode);
    }

    res.json({ session });
  } catch (error) {
    console.error('Update claude session error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /claude/sessions/:id
router.delete('/sessions/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ClaudeSession.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!session) { res.status(404).json({ error: 'Session non trouvée' }); return; }

    if (isRunning(req.params.id)) {
      await killProcess(req.params.id);
    }
    await ClaudeMessage.deleteMany({ sessionId: req.params.id });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete claude session error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== Messages ====================

// GET /claude/sessions/:id/messages
router.get('/sessions/:id/messages', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const messages = await ClaudeMessage.find({ sessionId: req.params.id }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (error) {
    console.error('Get claude messages error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/send
router.post('/sessions/:id/send', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ClaudeSession.findOne({ _id: req.params.id, userId: req.userId });
    if (!session) { res.status(404).json({ error: 'Session non trouvée' }); return; }

    const { message } = req.body;
    if (!message) { res.status(400).json({ error: 'Message requis' }); return; }

    // Insert user message
    const userMsg = await ClaudeMessage.create({
      sessionId: session._id,
      role: 'user',
      type: 'user',
      content: typeof message === 'string' ? [{ type: 'text', text: message }] : message,
      contentText: typeof message === 'string' ? message : '',
      queued: isRunning(req.params.id),
    });

    // Emit user message via socket so all clients see it
    emitMessageCreated(userMsg.toObject());

    if (isRunning(req.params.id)) {
      queueMessage(req.params.id, message, userMsg._id.toString());
      res.json({ queued: true, message: userMsg });
    } else {
      await spawnClaudeProcess(session, message);
      res.json({ queued: false, message: userMsg });
    }
  } catch (error) {
    console.error('Send claude message error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/stop
router.post('/sessions/:id/stop', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await killProcess(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Stop claude session error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/clear
router.post('/sessions/:id/clear', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (isRunning(req.params.id)) {
      await killProcess(req.params.id);
    }
    await ClaudeMessage.deleteMany({ sessionId: req.params.id });
    await ClaudeSession.findByIdAndUpdate(req.params.id, {
      $set: { claudeSessionId: null, status: 'idle', lastError: null, totalCostUsd: 0, totalDurationMs: 0, updatedAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Clear claude messages error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/permission
router.post('/sessions/:id/permission', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { behavior, updatedInput } = req.body;
    respondToPermission(req.params.id, behavior, updatedInput);
    res.json({ success: true });
  } catch (error) {
    console.error('Permission response error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/shell
router.post('/sessions/:id/shell', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const session = await ClaudeSession.findOne({ _id: req.params.id, userId: req.userId });
    if (!session) { res.status(404).json({ error: 'Session non trouvée' }); return; }

    const { command } = req.body;
    if (!command) { res.status(400).json({ error: 'Commande requise' }); return; }

    // Insert shell command message
    const cmdMsg = await ClaudeMessage.create({
      sessionId: session._id,
      role: 'user',
      type: 'shell_command',
      content: [{ type: 'text', text: command }],
      contentText: command,
      shellCommand: command,
    });

    let cwd = session.cwd || process.env.HOME || '/tmp';
    if (cwd.startsWith('~/')) cwd = cwd.replace(/^~/, os.homedir());

    emitMessageCreated(cmdMsg.toObject());
    execShellCommand(req.params.id, command, cwd);
    res.json({ success: true, message: cmdMsg });
  } catch (error) {
    console.error('Shell command error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /claude/sessions/:id/mark-seen
router.post('/sessions/:id/mark-seen', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ClaudeSession.findByIdAndUpdate(req.params.id, {
      $set: { unseenCompleted: false, updatedAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Mark seen error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /claude/home-dir
router.get('/home-dir', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ homeDir: os.homedir() });
});

export default router;
