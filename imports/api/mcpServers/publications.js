import { Meteor } from 'meteor/meteor';
import { MCPServersCollection } from './collections.js';

/**
 * Publish all MCP server configurations
 * No filtering needed (single-user app)
 */
Meteor.publish('mcpServers', function() {
  return MCPServersCollection.find({});
});
