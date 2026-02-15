import { Meteor } from 'meteor/meteor';
import { MCPServersCollection } from './collections.js';

/**
 * Publish MCP server configurations for the current user
 */
Meteor.publish('mcpServers', function() {
  if (!this.userId) return this.ready();
  return MCPServersCollection.find({ userId: this.userId });
});
