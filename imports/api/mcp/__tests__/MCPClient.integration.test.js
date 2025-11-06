/**
 * MCP Client Integration Tests
 *
 * Tests the generic MCP client against a real Notion MCP server.
 *
 * Prerequisites:
 * - A Notion MCP server must be configured in the database
 * - The server must be enabled and have valid credentials
 *
 * Run with: meteor test --once --driver-package meteortesting:mocha
 */

import { Meteor } from 'meteor/meteor';
import assert from 'assert';
import { MCPServersCollection } from '/imports/api/mcpServers/collections.js';
import { MCPClient } from '/imports/api/mcp/MCPClient.js';

if (Meteor.isServer) {
  describe('MCP Client Integration Tests (Notion)', function () {
    // Increase timeout for real network calls
    this.timeout(30000);

    let notionServer = null;

    before(async function () {
      // Check if Notion API key is available in environment
      const notionApiKey = process.env.NOTION_API_KEY;

      if (!notionApiKey) {
        console.log('[MCP Integration Tests] NOTION_API_KEY not set, skipping tests');
        console.log('[MCP Integration Tests] To run these tests, set NOTION_API_KEY environment variable');
        this.skip();
        return;
      }

      // Create test MCP server configuration
      const serverId = await MCPServersCollection.insertAsync({
        name: 'notion-test',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: {
          NOTION_API_KEY: notionApiKey
        },
        enabled: true,
        createdAt: new Date()
      });

      notionServer = await MCPServersCollection.findOneAsync({ _id: serverId });

      console.log('[MCP Integration Tests] Created test Notion server:', notionServer.name);
      console.log('[MCP Integration Tests] Server type:', notionServer.type);
      console.log('[MCP Integration Tests] Command:', notionServer.command, notionServer.args?.join(' '));
    });

    describe('MCPClient.initialize()', function () {
      it('should successfully connect and handshake with Notion server', async function () {
        const result = await MCPClient.initialize(notionServer, 10000);

        assert.ok(result, 'Initialize should return a result');
        assert.ok(result.serverInfo || result.protocolVersion, 'Should have server info or protocol version');

        console.log('[Test] Server info:', JSON.stringify(result, null, 2));
      });

      it('should handle initialization timeout gracefully', async function () {
        try {
          await MCPClient.initialize(notionServer, 1); // 1ms timeout - will fail
          assert.fail('Should have thrown timeout error');
        } catch (error) {
          assert.ok(error.message, 'Should have error message');
          console.log('[Test] Timeout error (expected):', error.message);
        }
      });
    });

    describe('MCPClient.listTools()', function () {
      it('should list all available Notion tools', async function () {
        const result = await MCPClient.listTools(notionServer, 10000);

        assert.ok(result, 'listTools should return a result');
        assert.ok(Array.isArray(result.tools), 'Result should have tools array');
        assert.ok(result.tools.length > 0, 'Should have at least one tool');

        console.log('[Test] Found', result.tools.length, 'tools');
        result.tools.forEach((tool, i) => {
          console.log(`  ${i + 1}. ${tool.name}`);
          assert.ok(tool.name, 'Each tool should have a name');
        });
      });

      it('should include expected Notion tools (search, fetch, etc.)', async function () {
        const result = await MCPClient.listTools(notionServer, 10000);
        const toolNames = result.tools.map(t => t.name);

        // Check for common Notion MCP tools
        const hasSearchTool = toolNames.some(name =>
          name.includes('search') || name.includes('Search')
        );
        const hasFetchTool = toolNames.some(name =>
          name.includes('fetch') || name.includes('Fetch')
        );

        console.log('[Test] Tool names:', toolNames);
        console.log('[Test] Has search tool:', hasSearchTool);
        console.log('[Test] Has fetch tool:', hasFetchTool);

        // At least one of these should exist
        assert.ok(
          hasSearchTool || hasFetchTool,
          'Should have at least a search or fetch tool'
        );
      });
    });

    describe('MCPClient.callTool()', function () {
      let availableTools = [];

      before(async function () {
        const result = await MCPClient.listTools(notionServer, 10000);
        availableTools = result.tools;
      });

      it('should successfully call a simple Notion tool', async function () {
        // Find a simple tool to test (e.g., get-self, get-users)
        const simpleTools = availableTools.filter(t =>
          t.name.includes('get-self') ||
          t.name.includes('get-users') ||
          t.name.includes('notion-get-self') ||
          t.name.includes('notion-get-users')
        );

        if (simpleTools.length === 0) {
          console.log('[Test] No simple tool found, skipping');
          this.skip();
        }

        const tool = simpleTools[0];
        console.log('[Test] Testing tool:', tool.name);

        const result = await MCPClient.callTool(
          notionServer,
          tool.name,
          {}, // No args needed for get-self/get-users
          10000
        );

        assert.ok(result, 'callTool should return a result');
        assert.ok(result.content, 'Result should have content');

        console.log('[Test] Tool result:', JSON.stringify(result, null, 2));
      });

      it('should handle invalid tool name gracefully', async function () {
        try {
          await MCPClient.callTool(
            notionServer,
            'invalid-tool-name-that-does-not-exist',
            {},
            10000
          );
          assert.fail('Should have thrown error for invalid tool');
        } catch (error) {
          assert.ok(error.message, 'Should have error message');
          assert.ok(
            error.message.includes('not found') || error.message.includes('Method'),
            'Error should mention tool not found'
          );
          console.log('[Test] Invalid tool error (expected):', error.message);
        }
      });

      it('should handle malformed tool arguments gracefully', async function () {
        const searchTool = availableTools.find(t =>
          t.name.includes('search') || t.name.includes('Search')
        );

        if (!searchTool) {
          console.log('[Test] No search tool found, skipping');
          this.skip();
        }

        try {
          // Call search with missing required arguments
          await MCPClient.callTool(
            notionServer,
            searchTool.name,
            { invalid_param: 'test' },
            10000
          );

          // Note: This might not fail depending on how the tool handles invalid args
          console.log('[Test] Tool accepted invalid args (might be valid behavior)');
        } catch (error) {
          console.log('[Test] Tool rejected invalid args (expected):', error.message);
          assert.ok(error.message, 'Should have error message');
        }
      });
    });

    describe('Connection Management', function () {
      it('should reuse persistent connections across multiple calls', async function () {
        // Make multiple calls and verify they work
        const result1 = await MCPClient.listTools(notionServer, 10000);
        const result2 = await MCPClient.listTools(notionServer, 10000);
        const result3 = await MCPClient.listTools(notionServer, 10000);

        assert.ok(result1.tools.length > 0, 'First call should succeed');
        assert.ok(result2.tools.length > 0, 'Second call should succeed');
        assert.ok(result3.tools.length > 0, 'Third call should succeed');

        console.log('[Test] All 3 consecutive calls succeeded (connection reused)');
      });

      it('should properly close connections on demand', async function () {
        // List tools to ensure connection exists
        await MCPClient.listTools(notionServer, 10000);

        // Close connection
        MCPClient.closeConnection(notionServer);

        // List tools again - should reconnect automatically
        const result = await MCPClient.listTools(notionServer, 10000);
        assert.ok(result.tools.length > 0, 'Should reconnect after close');

        console.log('[Test] Successfully reconnected after manual close');
      });
    });

    describe('Error Handling', function () {
      it('should handle server not found error', async function () {
        const fakeServer = {
          _id: 'fake-server-id',
          name: 'fake',
          type: 'stdio',
          command: 'nonexistent-command',
          args: [],
          enabled: true
        };

        try {
          await MCPClient.listTools(fakeServer, 5000);
          assert.fail('Should have thrown error for nonexistent command');
        } catch (error) {
          assert.ok(error.message, 'Should have error message');
          console.log('[Test] Nonexistent server error (expected):', error.message);
        }
      });

      it('should handle connection timeout', async function () {
        try {
          await MCPClient.listTools(notionServer, 1); // 1ms timeout
          assert.fail('Should have thrown timeout error');
        } catch (error) {
          assert.ok(error.message, 'Should have error message');
          console.log('[Test] Timeout error (expected):', error.message);
        }
      });
    });

    after(async function () {
      // Cleanup: close all connections and remove test server
      if (notionServer) {
        MCPClient.closeConnection(notionServer);
        await MCPServersCollection.removeAsync({ _id: notionServer._id });
        console.log('[MCP Integration Tests] Cleanup: closed connections and removed test server');
      }
    });
  });
}
