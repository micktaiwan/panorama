import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { ClaudeSessionsCollection } from './collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { spawnClaudeProcess, killProcess, queueMessage, clearQueue, dequeueMessage, respondToPermission, execShellCommand, execCodexCommand, isRunning, syncPermissionMode, execDebate, stopDebate } from './processManager';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth';

const TAG = '[claude-methods]';

Meteor.methods({
  'system.getHomeDir'() {
    return process.env.HOME || '';
  },

  async 'claudeSessions.create'(doc) {
    check(doc, Object);
    const userId = requireUserId();
    console.log(TAG, 'create', doc.name);
    const now = new Date();
    const session = {
      userId,
      projectId: doc.projectId ? String(doc.projectId) : undefined,
      name: String(doc.name || 'New Session').trim(),
      cwd: String(doc.cwd || '').trim() || undefined,
      model: doc.model ? String(doc.model).trim() : undefined,
      permissionMode: doc.permissionMode ? String(doc.permissionMode).trim() : undefined,
      appendSystemPrompt: doc.appendSystemPrompt ? String(doc.appendSystemPrompt) : undefined,
      activeAgent: 'claude',
      codexModel: doc.codexModel ? String(doc.codexModel).trim() : undefined,
      codexReasoningEffort: doc.codexReasoningEffort ? String(doc.codexReasoningEffort).trim() : undefined,
      claudeEffort: doc.claudeEffort ? String(doc.claudeEffort).trim() : undefined,
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
    await requireOwnership(ClaudeProjectsCollection, projectId);
    const project = await ClaudeProjectsCollection.findOneAsync(projectId);

    // Count existing sessions to auto-name (unless a name is provided)
    const name = options.name || `Session ${await ClaudeSessionsCollection.find({ projectId }).countAsync() + 1}`;
    const userId = requireUserId();
    const now = new Date();
    const session = {
      userId,
      projectId,
      name,
      cwd: project.cwd,
      model: project.model,
      permissionMode: project.permissionMode,
      appendSystemPrompt: project.appendSystemPrompt,
      activeAgent: 'claude',
      codexModel: project.codexModel,
      codexReasoningEffort: project.codexReasoningEffort,
      claudeEffort: project.claudeEffort,
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
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.name === 'string') set.name = set.name.trim();
    if (typeof set.cwd === 'string') set.cwd = set.cwd.trim();
    if (typeof set.model === 'string') set.model = set.model.trim();
    if (typeof set.codexModel === 'string') set.codexModel = set.codexModel.trim();
    if (typeof set.codexReasoningEffort === 'string') set.codexReasoningEffort = set.codexReasoningEffort.trim();
    if (typeof set.claudeEffort === 'string') set.claudeEffort = set.claudeEffort.trim();
    if (typeof set.activeAgent === 'string') set.activeAgent = set.activeAgent.trim();
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

  async 'claudeSessions.sendMessage'(sessionId, message, images) {
    check(sessionId, String);
    check(message, String);
    check(images, Match.Maybe([{ data: String, mediaType: String }]));
    const session = await requireOwnership(ClaudeSessionsCollection, sessionId);

    console.log(TAG, 'sendMessage', sessionId, 'status:', session.status, 'images:', images?.length || 0);

    if (session.debateRunning) {
      throw new Meteor.Error('busy', 'A debate is running. Stop it with ESC or /stop.');
    }

    // Collect unconsumed shell results to inject as context
    const shellResults = await ClaudeMessagesCollection.find(
      { sessionId, type: 'shell_result', shellConsumed: { $ne: true } },
      { sort: { createdAt: 1 } }
    ).fetchAsync();

    let textForClaude = message;
    if (shellResults.length > 0) {
      const shellContext = shellResults.map(sr =>
        `$ ${sr.shellCommand}\n${sr.contentText}`
      ).join('\n\n');
      textForClaude = `[Shell commands executed]\n\`\`\`\n${shellContext}\n\`\`\`\n\n${message}`;

      const ids = shellResults.map(sr => sr._id);
      await ClaudeMessagesCollection.updateAsync(
        { _id: { $in: ids } },
        { $set: { shellConsumed: true } },
        { multi: true }
      );
    }

    // Build content blocks for the DB message (display: images + original text)
    const displayBlocks = [];
    if (images?.length) {
      for (const img of images) {
        displayBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
    }
    displayBlocks.push({ type: 'text', text: message });

    // Insert user message immediately so it appears in the chat
    const isQueued = session.status === 'running';
    const msgId = await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'user',
      type: 'user',
      content: displayBlocks,
      contentText: message,
      ...(isQueued && { queued: true }),
      createdAt: new Date(),
    });

    // Build content for Claude: image blocks + text (with shell context)
    let messageForClaude;
    if (images?.length) {
      const contentBlocks = [];
      for (const img of images) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
      contentBlocks.push({ type: 'text', text: textForClaude });
      messageForClaude = contentBlocks;
    } else {
      messageForClaude = textForClaude;
    }

    if (session.status === 'running') {
      // Claude is busy — queue message for later processing
      queueMessage(sessionId, messageForClaude, msgId);
    } else {
      // Spawn is fire-and-forget from the method's perspective
      spawnClaudeProcess(session, messageForClaude);
    }
    return true;
  },

  async 'claudeSessions.execShell'(sessionId, command) {
    check(sessionId, String);
    check(command, String);
    const session = await requireOwnership(ClaudeSessionsCollection, sessionId);
    let cwd = session.cwd || process.env.HOME + '/projects';
    if (cwd.startsWith('~/')) cwd = process.env.HOME + cwd.slice(1);

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

  async 'claudeSessions.execCodex'(sessionId, prompt, options) {
    check(sessionId, String);
    check(prompt, String);
    check(options, Match.Maybe(Object));

    const session = await requireOwnership(ClaudeSessionsCollection, sessionId);

    let cwd = session.cwd || process.env.HOME + '/projects';
    if (cwd.startsWith('~/')) cwd = process.env.HOME + cwd.slice(1);

    const isConversational = options?.conversational;

    // Insert command message immediately
    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'user',
      type: isConversational ? 'user' : 'codex_command',
      content: [{ type: 'text', text: isConversational ? prompt : `/codex ${prompt}` }],
      contentText: isConversational ? prompt : `/codex ${prompt}`,
      createdAt: new Date(),
    });

    // Build enriched prompt with conversation context when in conversational mode
    let enrichedPrompt = prompt;
    if (isConversational) {
      const recentMessages = await ClaudeMessagesCollection.find(
        { sessionId, role: { $in: ['user', 'assistant'] }, type: { $nin: ['codex_command', 'shell_command', 'shell_result'] } },
        { sort: { createdAt: -1 }, limit: 20 }
      ).fetchAsync();

      if (recentMessages.length > 1) {
        const contextLines = recentMessages.reverse().slice(0, -1).map(m => {
          const role = m.role === 'user' ? 'User' : (m.type === 'codex_result' ? 'Codex' : 'Claude');
          const text = (m.contentText || '').slice(0, 500);
          return `[${role}]: ${text}`;
        });
        enrichedPrompt = `Here is the conversation context:\n\n${contextLines.join('\n\n')}\n\n---\nNow answer this:\n${prompt}`;
      }
    }

    // Set codexRunning flag for spinner
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { codexRunning: true, updatedAt: new Date() }
    });

    // Execute async (fire-and-forget)
    execCodexCommand(sessionId, enrichedPrompt, cwd, {
      model: session.codexModel,
      reasoningEffort: session.codexReasoningEffort,
    });
    return true;
  },

  async 'claudeSessions.execDebate'(sessionId, subject) {
    check(sessionId, String);
    check(subject, String);

    const session = await requireOwnership(ClaudeSessionsCollection, sessionId);
    if (session.status === 'running') throw new Meteor.Error('busy', 'Claude is already running');
    if (session.debateRunning) throw new Meteor.Error('busy', 'A debate is already running');
    if (session.codexRunning) throw new Meteor.Error('busy', 'Codex is already running');

    let cwd = session.cwd || process.env.HOME + '/projects';
    if (cwd.startsWith('~/')) cwd = process.env.HOME + cwd.slice(1);

    // Insert command message
    await ClaudeMessagesCollection.insertAsync({
      sessionId,
      role: 'user',
      type: 'debate_command',
      content: [{ type: 'text', text: `/debate ${subject}` }],
      contentText: `/debate ${subject}`,
      debateSubject: subject,
      createdAt: new Date(),
    });

    // Set debate flags
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        debateRunning: true,
        debateRound: 1,
        debateCurrentAgent: 'codex',
        debateSubject: subject,
        updatedAt: new Date(),
      }
    });

    // Fire-and-forget the orchestrator
    execDebate(sessionId, subject, cwd, session);
    return true;
  },

  async 'claudeSessions.stopDebate'(sessionId) {
    check(sessionId, String);
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    stopDebate(sessionId);
    // Clear flags immediately for UI responsiveness
    await ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: {
        debateRunning: false,
        debateRound: null,
        debateCurrentAgent: null,
        debateSubject: null,
        updatedAt: new Date(),
      }
    });
    return true;
  },

  async 'claudeSessions.stop'(sessionId) {
    check(sessionId, String);
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    await killProcess(sessionId);
    return true;
  },

  async 'claudeSessions.remove'(sessionId) {
    check(sessionId, String);
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    await killProcess(sessionId);
    await ClaudeMessagesCollection.removeAsync({ sessionId });
    return ClaudeSessionsCollection.removeAsync(sessionId);
  },

  async 'claudeSessions.respondToPermission'(sessionId, behavior, updatedToolInput) {
    check(sessionId, String);
    check(behavior, Match.OneOf('allow', 'allowAll', 'deny'));
    check(updatedToolInput, Match.Maybe(Object));
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    respondToPermission(sessionId, behavior, updatedToolInput);
  },

  async 'claudeSessions.clearMessages'(sessionId) {
    check(sessionId, String);
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    await clearQueue(sessionId);
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

  async 'claudeSessions.dequeueMessage'(sessionId, msgId) {
    check(sessionId, String);
    check(msgId, String);
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    const removed = await dequeueMessage(sessionId, msgId);
    if (removed) {
      await ClaudeMessagesCollection.removeAsync(msgId);
    }
    return removed;
  },

  async 'claudeSessions.changeCwd'(sessionId, newCwd) {
    check(sessionId, String);
    check(newCwd, String);
    newCwd = newCwd.trim();
    if (!newCwd) throw new Meteor.Error('invalid', 'CWD cannot be empty');

    const session = await requireOwnership(ClaudeSessionsCollection, sessionId);

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
      userId: requireUserId(),
      projectId: session.projectId,
      name: session.projectId ? `Session ${count + 1}` : (session.name + ' (new cwd)'),
      cwd: newCwd,
      model: session.model,
      permissionMode: session.permissionMode,
      appendSystemPrompt: session.appendSystemPrompt,
      activeAgent: session.activeAgent || 'claude',
      codexModel: session.codexModel,
      codexReasoningEffort: session.codexReasoningEffort,
      claudeEffort: session.claudeEffort,
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
    await requireOwnership(ClaudeSessionsCollection, sessionId);
    return ClaudeSessionsCollection.updateAsync(sessionId, {
      $set: { unseenCompleted: false, updatedAt: new Date() }
    });
  },

  async 'claudeSessions.countInterrupted'() {
    const userId = requireUserId();
    return ClaudeSessionsCollection.find({ status: 'interrupted', userId }).countAsync();
  },

  async 'claudeSessions.cleanupInterrupted'() {
    const userId = requireUserId();
    const count = await ClaudeSessionsCollection.updateAsync(
      { status: 'interrupted', userId },
      { $set: { status: 'idle', pid: null, updatedAt: new Date() } },
      { multi: true }
    );
    console.log(TAG, 'cleanupInterrupted:', count, 'session(s) reset to idle');
    return count;
  },

  async 'claudeTeams.getState'() {
    const homeDir = process.env.HOME || '';
    const teamsDir = path.join(homeDir, '.claude', 'teams');
    const tasksDir = path.join(homeDir, '.claude', 'tasks');

    let teamEntries;
    try {
      teamEntries = await fs.promises.readdir(teamsDir, { withFileTypes: true });
    } catch {
      return { teams: [] };
    }

    const teams = [];
    for (const entry of teamEntries) {
      if (!entry.isDirectory()) continue;
      const teamName = entry.name;

      // Read team config
      let config;
      try {
        const raw = await fs.promises.readFile(path.join(teamsDir, teamName, 'config.json'), 'utf8');
        config = JSON.parse(raw);
      } catch {
        continue;
      }

      // Read tasks for this team
      const tasks = [];
      try {
        const taskFiles = await fs.promises.readdir(path.join(tasksDir, teamName));
        for (const tf of taskFiles) {
          if (!tf.endsWith('.json')) continue;
          try {
            const raw = await fs.promises.readFile(path.join(tasksDir, teamName, tf), 'utf8');
            tasks.push(JSON.parse(raw));
          } catch { /* skip malformed */ }
        }
      } catch { /* no tasks dir */ }

      teams.push({
        name: teamName,
        members: config.members || [],
        description: config.description || '',
        tasks: tasks.sort((a, b) => Number(a.id || 0) - Number(b.id || 0)),
      });
    }

    return { teams };
  },
});
