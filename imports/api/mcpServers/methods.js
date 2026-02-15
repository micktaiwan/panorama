import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { MCPServersCollection } from './collections.js';
import { MCPClient } from '/imports/api/mcp/MCPClient.js';
import { ensureLoggedIn, ensureOwner } from '/imports/api/_shared/auth';

/**
 * Meteor methods for MCP Servers management
 */

Meteor.methods({
  /**
   * Create a new MCP server configuration
   */
  async 'mcpServers.create'(config) {
    check(config, {
      name: String,
      type: String,
      enabled: Match.Optional(Boolean),
      // stdio fields
      command: Match.Optional(String),
      args: Match.Optional([String]),
      env: Match.Optional(Object),
      // http fields
      url: Match.Optional(String),
      headers: Match.Optional(Object)
    });
    ensureLoggedIn(this.userId);

    // Validate type
    if (!['stdio', 'http'].includes(config.type)) {
      throw new Meteor.Error('invalid-type', 'Type must be "stdio" or "http"');
    }

    // Validate required fields based on type
    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Meteor.Error('missing-field', 'stdio type requires "command" field');
      }
      if (!config.args || !Array.isArray(config.args)) {
        throw new Meteor.Error('missing-field', 'stdio type requires "args" array field');
      }
    } else if (config.type === 'http') {
      if (!config.url) {
        throw new Meteor.Error('missing-field', 'http type requires "url" field');
      }
    }

    // Check if name already exists for this user
    const existing = await MCPServersCollection.findOneAsync({ name: config.name, userId: this.userId });
    if (existing) {
      throw new Meteor.Error('duplicate-name', 'A server with this name already exists');
    }

    const now = new Date();
    const serverDoc = {
      name: config.name.trim(),
      type: config.type,
      enabled: config.enabled !== false,
      userId: this.userId,
      createdAt: now
    };

    // Add type-specific fields
    if (config.type === 'stdio') {
      serverDoc.command = config.command.trim();
      serverDoc.args = config.args;
      serverDoc.env = config.env || {};
    } else if (config.type === 'http') {
      serverDoc.url = config.url.trim();
      serverDoc.headers = config.headers || {};
    }

    const serverId = await MCPServersCollection.insertAsync(serverDoc);
    return serverId;
  },

  /**
   * Update an existing MCP server configuration
   */
  async 'mcpServers.update'(serverId, updates) {
    check(serverId, String);
    check(updates, {
      name: Match.Optional(String),
      enabled: Match.Optional(Boolean),
      // stdio fields
      command: Match.Optional(String),
      args: Match.Optional([String]),
      env: Match.Optional(Object),
      // http fields
      url: Match.Optional(String),
      headers: Match.Optional(Object)
    });
    ensureLoggedIn(this.userId);
    await ensureOwner(MCPServersCollection, serverId, this.userId);

    const updateDoc = {};

    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      // Check if name is taken by another server for this user
      const existing = await MCPServersCollection.findOneAsync({
        name: trimmedName,
        userId: this.userId,
        _id: { $ne: serverId }
      });
      if (existing) {
        throw new Meteor.Error('duplicate-name', 'A server with this name already exists');
      }
      updateDoc.name = trimmedName;
    }

    if (updates.enabled !== undefined) {
      updateDoc.enabled = updates.enabled;
    }

    // Update type-specific fields
    if (server.type === 'stdio') {
      if (updates.command !== undefined) updateDoc.command = updates.command.trim();
      if (updates.args !== undefined) updateDoc.args = updates.args;
      if (updates.env !== undefined) updateDoc.env = updates.env;
    } else if (server.type === 'http') {
      if (updates.url !== undefined) updateDoc.url = updates.url.trim();
      if (updates.headers !== undefined) updateDoc.headers = updates.headers;
    }

    await MCPServersCollection.updateAsync({ _id: serverId }, { $set: updateDoc });
    return true;
  },

  /**
   * Remove an MCP server configuration
   */
  async 'mcpServers.remove'(serverId) {
    check(serverId, String);
    ensureLoggedIn(this.userId);
    await ensureOwner(MCPServersCollection, serverId, this.userId);

    await MCPServersCollection.removeAsync({ _id: serverId });
    return true;
  },

  /**
   * Test connection to an MCP server
   * Attempts to initialize and list tools
   */
  async 'mcpServers.testConnection'(serverId) {
    check(serverId, String);
    ensureLoggedIn(this.userId);
    const server = await ensureOwner(MCPServersCollection, serverId, this.userId);

    const timeout = 10000; // 10s for testing

    try {
      // Try initialize handshake
      const initResult = await MCPClient.initialize(server, timeout);
      console.log('[mcpServers.testConnection] Initialize result:', initResult);

      // Try listing tools
      const toolsResult = await MCPClient.listTools(server, timeout);
      console.log('[mcpServers.testConnection] Tools result:', toolsResult);

      // Update lastConnectedAt
      await MCPServersCollection.updateAsync(
        { _id: serverId },
        {
          $set: {
            lastConnectedAt: new Date(),
            lastError: null
          }
        }
      );

      return {
        success: true,
        serverInfo: initResult,
        tools: toolsResult.tools || []
      };
    } catch (error) {
      console.error('[mcpServers.testConnection] Error:', error);

      // Update lastError
      await MCPServersCollection.updateAsync(
        { _id: serverId },
        {
          $set: {
            lastError: error.message
          }
        }
      );

      throw new Meteor.Error('connection-failed', `Connection test failed: ${error.message}`);
    }
  },

  /**
   * Call a tool on an MCP server
   * Main method for executing MCP tools
   */
  async 'mcpServers.callTool'(serverId, toolName, args) {
    check(serverId, String);
    check(toolName, String);
    check(args, Match.Optional(Object));
    ensureLoggedIn(this.userId);
    const server = await ensureOwner(MCPServersCollection, serverId, this.userId);

    if (!server.enabled) {
      throw new Meteor.Error('disabled', 'This server is disabled');
    }

    const timeout = 30000; // 30s for tool calls

    try {
      const result = await MCPClient.callTool(server, toolName, args || {}, timeout);

      // Update lastConnectedAt on success
      await MCPServersCollection.updateAsync(
        { _id: serverId },
        {
          $set: {
            lastConnectedAt: new Date(),
            lastError: null
          }
        }
      );

      return result;
    } catch (error) {
      console.error('[mcpServers.callTool] Error:', error);

      // Update lastError
      await MCPServersCollection.updateAsync(
        { _id: serverId },
        {
          $set: {
            lastError: error.message
          }
        }
      );

      throw new Meteor.Error('tool-call-failed', `Tool call failed: ${error.message}`);
    }
  },

  /**
   * Sync MCP servers from Claude Desktop config
   * Reads claude_desktop_config.json and imports server configurations
   */
  async 'mcpServers.syncFromClaudeDesktop'() {
    ensureLoggedIn(this.userId);
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    // Determine config path based on OS
    const homeDir = os.homedir();
    let configPath;

    if (process.platform === 'darwin') {
      // macOS
      configPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else if (process.platform === 'win32') {
      // Windows
      configPath = path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    } else {
      // Linux
      configPath = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
    }

    // Check if file exists
    try {
      await fs.access(configPath);
    } catch (error) {
      throw new Meteor.Error('config-not-found', `Claude Desktop config not found at: ${configPath}`);
    }

    // Read and parse config
    let config;
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(configContent);
    } catch (error) {
      throw new Meteor.Error('config-parse-error', `Failed to read or parse config: ${error.message}`);
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      throw new Meteor.Error('no-servers', 'No MCP servers found in Claude Desktop config');
    }

    const results = {
      imported: [],
      skipped: [],
      errors: []
    };

    // Import each server
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        // Check if server already exists
        const existing = await MCPServersCollection.findOneAsync({ name: serverName, userId: this.userId });
        if (existing) {
          results.skipped.push({
            name: serverName,
            reason: 'Already exists'
          });
          continue;
        }

        // Determine server type (stdio or http)
        let type, serverDoc;

        if (serverConfig.command) {
          // stdio type
          type = 'stdio';
          serverDoc = {
            name: serverName,
            type: 'stdio',
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env || {},
            enabled: true,
            userId: this.userId,
            createdAt: new Date()
          };
        } else if (serverConfig.url) {
          // http type
          type = 'http';
          serverDoc = {
            name: serverName,
            type: 'http',
            url: serverConfig.url,
            headers: serverConfig.headers || {},
            enabled: true,
            userId: this.userId,
            createdAt: new Date()
          };
        } else {
          results.errors.push({
            name: serverName,
            reason: 'Unknown server type (no command or url)'
          });
          continue;
        }

        // Insert server
        const serverId = await MCPServersCollection.insertAsync(serverDoc);
        results.imported.push({
          name: serverName,
          type,
          id: serverId
        });

      } catch (error) {
        console.error(`[mcpServers.syncFromClaudeDesktop] Error importing ${serverName}:`, error);
        results.errors.push({
          name: serverName,
          reason: error.message
        });
      }
    }

    return {
      summary: {
        total: results.imported.length + results.skipped.length + results.errors.length,
        imported: results.imported.length,
        skipped: results.skipped.length,
        errors: results.errors.length
      },
      imported: results.imported,
      skipped: results.skipped,
      errors: results.errors,
      configPath
    };
  }
});
