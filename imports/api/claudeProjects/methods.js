import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClaudeProjectsCollection } from './collections';
import { ClaudeSessionsCollection } from '/imports/api/claudeSessions/collections';
import { ClaudeMessagesCollection } from '/imports/api/claudeMessages/collections';
import { killProcess } from '/imports/api/claudeSessions/processManager';

const TAG = '[claude-projects]';

Meteor.methods({
  async 'claudeProjects.create'(doc) {
    check(doc, Object);
    const now = new Date();
    const project = {
      name: String(doc.name || 'New Project').trim(),
      cwd: doc.cwd ? String(doc.cwd).trim() : undefined,
      model: doc.model ? String(doc.model).trim() : undefined,
      permissionMode: doc.permissionMode ? String(doc.permissionMode).trim() : undefined,
      appendSystemPrompt: doc.appendSystemPrompt ? String(doc.appendSystemPrompt) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    console.log(TAG, 'create', project.name);
    const projectId = await ClaudeProjectsCollection.insertAsync(project);

    // Create first session automatically
    await ClaudeSessionsCollection.insertAsync({
      projectId,
      name: 'Session 1',
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
    });

    return projectId;
  },

  async 'claudeProjects.update'(projectId, modifier) {
    check(projectId, String);
    check(modifier, Object);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.name === 'string') set.name = set.name.trim();
    if (typeof set.cwd === 'string') set.cwd = set.cwd.trim();
    if (typeof set.model === 'string') set.model = set.model.trim();
    return ClaudeProjectsCollection.updateAsync(projectId, { $set: set });
  },

  async 'claudeProjects.remove'(projectId) {
    check(projectId, String);
    console.log(TAG, 'remove', projectId);

    // Kill all running processes for sessions in this project
    const sessions = await ClaudeSessionsCollection.find({ projectId }).fetchAsync();
    for (const s of sessions) {
      await killProcess(s._id);
    }

    // Remove all messages for all sessions in this project
    const sessionIds = sessions.map(s => s._id);
    if (sessionIds.length > 0) {
      await ClaudeMessagesCollection.removeAsync({ sessionId: { $in: sessionIds } });
    }

    // Remove all sessions
    await ClaudeSessionsCollection.removeAsync({ projectId });

    // Remove the project
    return ClaudeProjectsCollection.removeAsync(projectId);
  },
});
