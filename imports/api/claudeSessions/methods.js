import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClaudeSessionsCollection } from './collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { spawnClaudeProcess, killProcess, queueMessage, clearQueue, respondToPermission, execShellCommand, isRunning, syncPermissionMode } from './processManager';

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
      unseenCompleted: false,
      totalCostUsd: 0,
      totalDurationMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    return ClaudeSessionsCollection.insertAsync(session);
  },

  async 'claudeSessions.createInProject'(projectId, options = {}) {
    check(projectId, String);
    check(options, Match.Optional(Object));
    const { ClaudeProjectsCollection } = await import('/imports/api/claudeProjects/collections');
    const project = await ClaudeProjectsCollection.findOneAsync(projectId);
    if (!project) throw new Meteor.Error('not-found', 'Project not found');

    // Count existing sessions to auto-name (unless a name is provided)
    const name = options.name || `Session ${await ClaudeSessionsCollection.find({ projectId }).countAsync() + 1}`;
    const now = new Date();
    const session = {
      projectId,
      name,
      cwd: project.cwd,
      model: project.model,
      permissionMode: project.permissionMode,
      appendSystemPrompt: project.appendSystemPrompt,
      claudeSessionId: null,
      status: 'idle',
      lastError: null,
      unseenCompleted: false,
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
    // Propagate cwd change to the project so new sessions inherit it
    if (typeof set.cwd === 'string') {
      const session = await ClaudeSessionsCollection.findOneAsync(sessionId, { fields: { projectId: 1 } });
      if (session?.projectId) {
        const { ClaudeProjectsCollection } = await import('/imports/api/claudeProjects/collections');
        await ClaudeProjectsCollection.updateAsync(session.projectId, { $set: { cwd: set.cwd, updatedAt: new Date() } });
      }
    }
    const result = await ClaudeSessionsCollection.updateAsync(sessionId, { $set: set });

    // If permissionMode changed and process is running, sync mode to the running process
    if ('permissionMode' in modifier && isRunning(sessionId)) {
      await syncPermissionMode(sessionId, set.permissionMode || '');
    }

    return result;
  },

  async 'claudeSessions.sendMessage'(sessionId, message) {
    check(sessionId, String);
    check(message, String);
    const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
    if (!session) throw new Meteor.Error('not-found', 'Session not found');

    console.log(TAG, 'sendMessage', sessionId, 'status:', session.status, 'claudeSessionId:', session.claudeSessionId);

    // Collect unconsumed shell results to inject as context
    const shellResults = await ClaudeMessagesCollection.find(
      { sessionId, type: 'shell_result', shellConsumed: { $ne: true } },
      { sort: { createdAt: 1 } }
    ).fetchAsync();

    let messageForClaude = message;
    if (shellResults.length > 0) {
      const shellContext = shellResults.map(sr =>
        `$ ${sr.shellCommand}\n${sr.contentText}`
      ).join('\n\n');
      messageForClaude = `[Shell commands executed]\n\`\`\`\n${shellContext}\n\`\`\`\n\n${message}`;

      const ids = shellResults.map(sr => sr._id);
      await ClaudeMessagesCollection.updateAsync(
        { _id: { $in: ids } },
        { $set: { shellConsumed: true } },
        { multi: true }
      );
    }

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
      queueMessage(sessionId, messageForClaude);
    } else {
      // Spawn is fire-and-forget from the method's perspective
      spawnClaudeProcess(session, messageForClaude);
    }
    return true;
  },

  async 'claudeSessions.execShell'(sessionId, command) {
    check(sessionId, String);
    check(command, String);
    const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
    if (!session) throw new Meteor.Error('not-found', 'Session not found');
    const cwd = session.cwd || process.env.HOME + '/projects';

    // Insert the command message immediately
    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'user',
      type: 'shell_command',
      content: [{ type: 'text', text: command }],
      contentText: command,
      createdAt: new Date(),
    });

    // Execute async
    execShellCommand(sessionId, command, cwd);
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

  'claudeSessions.respondToPermission'(sessionId, behavior, updatedToolInput) {
    check(sessionId, String);
    check(behavior, Match.OneOf('allow', 'allowAll', 'deny'));
    check(updatedToolInput, Match.Maybe(Object));
    respondToPermission(sessionId, behavior, updatedToolInput);
  },

  async 'claudeSessions.clearMessages'(sessionId) {
    check(sessionId, String);
    clearQueue(sessionId);
    await ClaudeMessagesCollection.removeAsync({ sessionId });
    return ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        claudeSessionId: null,
        claudeCodeVersion: null,
        activeModel: null,
        lastModelUsage: null,
        totalCostUsd: 0,
        totalDurationMs: 0,
        updatedAt: new Date(),
      }
    });
  },

  async 'claudeSessions.changeCwd'(sessionId, newCwd) {
    check(sessionId, String);
    check(newCwd, String);
    newCwd = newCwd.trim();
    if (!newCwd) throw new Meteor.Error('invalid', 'CWD cannot be empty');

    const session = await ClaudeSessionsCollection.findOneAsync(sessionId);
    if (!session) throw new Meteor.Error('not-found', 'Session not found');

    // Propagate cwd to project
    if (session.projectId) {
      const { ClaudeProjectsCollection } = await import('/imports/api/claudeProjects/collections');
      await ClaudeProjectsCollection.updateAsync(session.projectId, { $set: { cwd: newCwd, updatedAt: new Date() } });
    }

    // No active Claude session — just update cwd in place
    if (!session.claudeSessionId) {
      await ClaudeSessionsCollection.updateAsync(sessionId, { $set: { cwd: newCwd, updatedAt: new Date() } });
      return { sessionId };
    }

    // Active Claude session — stop it and create a new one
    await killProcess(sessionId);
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        status: 'error',
        lastError: `Session stopped: working directory changed to ${newCwd}`,
        claudeSessionId: null,
        pid: null,
        updatedAt: new Date(),
      }
    });

    // Create new session in the same project
    const now = new Date();
    const count = session.projectId
      ? await ClaudeSessionsCollection.find({ projectId: session.projectId }).countAsync()
      : 0;
    const newSessionId = await ClaudeSessionsCollection.insertAsync({
      projectId: session.projectId,
      name: session.projectId ? `Session ${count + 1}` : (session.name + ' (new cwd)'),
      cwd: newCwd,
      model: session.model,
      permissionMode: session.permissionMode,
      appendSystemPrompt: session.appendSystemPrompt,
      claudeSessionId: null,
      status: 'idle',
      lastError: null,
      unseenCompleted: false,
      totalCostUsd: 0,
      totalDurationMs: 0,
      createdAt: now,
      updatedAt: now,
    });

    console.log(TAG, 'changeCwd', sessionId, '→', newSessionId, 'cwd:', newCwd);
    return { sessionId: newSessionId, stopped: true };
  },

  async 'claudeSessions.markSeen'(sessionId) {
    check(sessionId, String);
    return ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { unseenCompleted: false, updatedAt: new Date() }
    });
  },

  async 'claudeSessions.countInterrupted'() {
    return ClaudeSessionsCollection.find({ status: 'interrupted' }).countAsync();
  },

  async 'claudeSessions.cleanupInterrupted'() {
    const count = await ClaudeSessionsCollection.updateAsync(
      { status: 'interrupted' },
      { $set: { status: 'idle', pid: null, updatedAt: new Date() } },
      { multi: true }
    );
    console.log(TAG, 'cleanupInterrupted:', count, 'session(s) reset to idle');
    return count;
  },
});
