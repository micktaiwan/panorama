import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClaudeSessionsCollection } from './collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { spawnClaudeProcess, killProcess, queueMessage, clearQueue } from './processManager';

const TAG = '[claude-methods]';

Meteor.methods({
  'system.getHomeDir'() {
    return process.env.HOME || '';
  },

  async 'claudeSessions.create'(doc) {
    check(doc, Object);
    console.log(TAG, 'create', doc.name);
    const now = new Date();
    const session = {
      projectId: doc.projectId ? String(doc.projectId) : undefined,
      name: String(doc.name || 'New Session').trim(),
      cwd: String(doc.cwd || '').trim() || undefined,
      model: doc.model ? String(doc.model).trim() : undefined,
      permissionMode: doc.permissionMode ? String(doc.permissionMode).trim() : undefined,
      appendSystemPrompt: doc.appendSystemPrompt ? String(doc.appendSystemPrompt) : undefined,
      claudeSessionId: null,
      status: 'idle',
      lastError: null,
      totalCostUsd: 0,
      totalDurationMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    return ClaudeSessionsCollection.insertAsync(session);
  },

  async 'claudeSessions.createInProject'(projectId) {
    check(projectId, String);
    const { ClaudeProjectsCollection } = await import('/imports/api/claudeProjects/collections');
    const project = await ClaudeProjectsCollection.findOneAsync(projectId);
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    // Count existing sessions to auto-name
    const count = await ClaudeSessionsCollection.find({ projectId }).countAsync();
    const now = new Date();
    const session = {
      projectId,
      name: `Session ${count + 1}`,
      cwd: project.cwd,
      model: project.model,
      permissionMode: project.permissionMode,
      appendSystemPrompt: project.appendSystemPrompt,
      claudeSessionId: null,
      status: 'idle',
      lastError: null,
      totalCostUsd: 0,
      totalDurationMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    console.log(TAG, 'createInProject', projectId, session.name);
    return ClaudeSessionsCollection.insertAsync(session);
  },

  async 'claudeSessions.update'(sessionId, modifier) {
    check(sessionId, String);
    check(modifier, Object);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.name === 'string') set.name = set.name.trim();
    if (typeof set.cwd === 'string') set.cwd = set.cwd.trim();
    if (typeof set.model === 'string') set.model = set.model.trim();
    return ClaudeSessionsCollection.updateAsync(sessionId, { $set: set });
  },

  async 'claudeSessions.sendMessage'(sessionId, message) {
    check(sessionId, String);
    check(message, String);
    const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
    if (!session) throw new Meteor.Error('not-found', 'Session not found');

    console.log(TAG, 'sendMessage', sessionId, 'status:', session.status, 'claudeSessionId:', session.claudeSessionId);

    // Insert user message immediately so it appears in the chat
    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'user',
      type: 'user',
      content: [{ type: 'text', text: message }],
      contentText: message,
      createdAt: new Date(),
    });

    if (session.status === 'running') {
      // Claude is busy — queue message for later processing
      queueMessage(sessionId, message);
    } else {
      // Spawn is fire-and-forget from the method's perspective
      spawnClaudeProcess(session, message);
    }
    return true;
  },

  async 'claudeSessions.stop'(sessionId) {
    check(sessionId, String);
    await killProcess(sessionId);
    return true;
  },

  async 'claudeSessions.remove'(sessionId) {
    check(sessionId, String);
    await killProcess(sessionId);
    await ClaudeMessagesCollection.removeAsync({ sessionId });
    return ClaudeSessionsCollection.removeAsync(sessionId);
  },

  async 'claudeSessions.clearMessages'(sessionId) {
    check(sessionId, String);
    clearQueue(sessionId);
    await ClaudeMessagesCollection.removeAsync({ sessionId });
    return ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        claudeSessionId: null,
        totalCostUsd: 0,
        totalDurationMs: 0,
        updatedAt: new Date(),
      }
    });
  },
});
