import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClaudeCommandsCollection } from './collections';
import { requireUserId, requireOwnership } from '/imports/api/_shared/auth';

const VALID_SCOPES = ['global', 'project'];

Meteor.methods({
  async 'claudeCommands.create'(doc) {
    check(doc, Object);
    const userId = requireUserId();
    const now = new Date();
    const name = String(doc.name || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) throw new Meteor.Error('invalid', 'Name is required');
    const content = String(doc.content || '');
    const command = {
      userId,
      name,
      description: String(doc.description || '').trim(),
      content,
      scope: VALID_SCOPES.includes(doc.scope) ? doc.scope : 'global',
      projectId: doc.scope === 'project' && doc.projectId ? String(doc.projectId) : undefined,
      hasArgs: content.includes('$ARGUMENTS'),
      source: doc.source || 'manual',
      sourceFile: doc.sourceFile || undefined,
      createdAt: now,
      updatedAt: now,
    };
    return ClaudeCommandsCollection.insertAsync(command);
  },

  async 'claudeCommands.update'(commandId, modifier) {
    check(commandId, String);
    check(modifier, Object);
    await requireOwnership(ClaudeCommandsCollection, commandId);
    const set = { ...modifier, updatedAt: new Date() };
    if (typeof set.name === 'string') set.name = set.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (typeof set.content === 'string') set.hasArgs = set.content.includes('$ARGUMENTS');
    if (set.scope && !VALID_SCOPES.includes(set.scope)) delete set.scope;
    return ClaudeCommandsCollection.updateAsync(commandId, { $set: set });
  },

  async 'claudeCommands.remove'(commandId) {
    check(commandId, String);
    await requireOwnership(ClaudeCommandsCollection, commandId);
    return ClaudeCommandsCollection.removeAsync(commandId);
  },

  async 'claudeCommands.importFromDisk'(options) {
    check(options, Match.Maybe(Object));
    const userId = requireUserId();
    const fs = await import('fs/promises');
    const path = await import('path');

    const results = { imported: 0, skipped: 0, errors: [] };
    const homeDir = process.env.HOME || '';

    const dirs = [];
    // Global commands from ~/.claude/commands/
    if (options?.global !== false) {
      dirs.push({ dir: path.default.join(homeDir, '.claude', 'commands'), scope: 'global' });
    }
    // Project commands from <cwd>/.claude/commands/
    if (options?.projectCwd) {
      let cwd = String(options.projectCwd);
      if (cwd.startsWith('~/')) cwd = homeDir + cwd.slice(1);
      dirs.push({ dir: path.default.join(cwd, '.claude', 'commands'), scope: 'project', projectId: options.projectId });
    }
    // Scan all Claude projects that have a cwd
    if (options?.allProjects) {
      const { ClaudeProjectsCollection } = require('/imports/api/claudeProjects/collections');
      const projects = await ClaudeProjectsCollection.find({ cwd: { $exists: true, $ne: '' } }, { fields: { cwd: 1 } }).fetchAsync();
      for (const proj of projects) {
        let cwd = proj.cwd;
        if (cwd.startsWith('~/')) cwd = homeDir + cwd.slice(1);
        dirs.push({ dir: path.default.join(cwd, '.claude', 'commands'), scope: 'project', projectId: proj._id });
      }
    }

    const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

    for (const { dir, scope, projectId } of dirs) {
      let files;
      try {
        files = await fs.default.readdir(dir);
      } catch {
        continue; // Directory doesn't exist
      }

      const mdFiles = files.filter(f => f.endsWith('.md'));
      for (const file of mdFiles) {
        try {
          const filePath = path.default.join(dir, file);
          const raw = await fs.default.readFile(filePath, 'utf-8');
          const match = raw.match(FRONTMATTER_RE);

          let name = file.replace(/\.md$/, '').toLowerCase().replace(/\s+/g, '-');
          let description = '';
          let content = raw;

          if (match) {
            const frontmatter = match[1];
            content = match[2].trim();
            // Parse simple YAML key: value
            for (const line of frontmatter.split('\n')) {
              const kv = line.match(/^(\w+):\s*(.+)$/);
              if (!kv) continue;
              if (kv[1] === 'description') description = kv[2].trim();
              if (kv[1] === 'name') name = kv[2].trim().toLowerCase().replace(/\s+/g, '-');
            }
          }

          // Upsert: if same name+scope exists, update; otherwise insert
          const query = { name, scope, userId };
          if (scope === 'project' && projectId) query.projectId = projectId;

          const existing = await ClaudeCommandsCollection.findOneAsync(query);
          const now = new Date();
          if (existing) {
            await ClaudeCommandsCollection.updateAsync(existing._id, {
              $set: {
                description,
                content,
                hasArgs: content.includes('$ARGUMENTS'),
                source: 'disk',
                sourceFile: filePath,
                updatedAt: now,
              }
            });
          } else {
            await ClaudeCommandsCollection.insertAsync({
              userId,
              name,
              description,
              content,
              scope,
              projectId: scope === 'project' ? projectId : undefined,
              hasArgs: content.includes('$ARGUMENTS'),
              source: 'disk',
              sourceFile: filePath,
              createdAt: now,
              updatedAt: now,
            });
          }
          results.imported++;
        } catch (err) {
          results.errors.push({ file, error: err.message });
        }
      }
    }

    return results;
  },
});
