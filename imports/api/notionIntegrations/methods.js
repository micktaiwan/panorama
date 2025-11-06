import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { NotionIntegrationsCollection } from './collections.js';

/**
 * CRUD methods for Notion Integrations
 */

Meteor.methods({
  /**
   * Create a new Notion integration configuration
   */
  async 'notionIntegrations.create'(doc) {
    check(doc, {
      name: String,
      databaseId: String,
      description: Match.Optional(String),
      filters: Match.Optional(Object),
      ownerMapping: Match.Optional(Object),
      pageSize: Match.Optional(Number),
      enabled: Match.Optional(Boolean)
    });

    const now = new Date();
    const integration = {
      name: (doc.name || '').trim(),
      databaseId: (doc.databaseId || '').trim(),
      description: doc.description?.trim() || '',
      filters: doc.filters || {},
      ownerMapping: doc.ownerMapping || {},
      pageSize: doc.pageSize || 3,
      enabled: doc.enabled !== false,
      createdAt: now,
      lastSyncAt: null
    };

    if (!integration.name) {
      throw new Meteor.Error('invalid-name', 'Integration name is required');
    }
    if (!integration.databaseId) {
      throw new Meteor.Error('invalid-database-id', 'Database ID is required');
    }

    const integrationId = await NotionIntegrationsCollection.insertAsync(integration);
    return integrationId;
  },

  /**
   * Update an existing Notion integration
   */
  async 'notionIntegrations.update'(integrationId, updates) {
    check(integrationId, String);
    check(updates, {
      name: Match.Optional(String),
      databaseId: Match.Optional(String),
      description: Match.Optional(String),
      filters: Match.Optional(Object),
      ownerMapping: Match.Optional(Object),
      pageSize: Match.Optional(Number),
      enabled: Match.Optional(Boolean)
    });

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    const updateDoc = {};
    if (updates.name !== undefined) updateDoc.name = updates.name.trim();
    if (updates.databaseId !== undefined) updateDoc.databaseId = updates.databaseId.trim();
    if (updates.description !== undefined) updateDoc.description = updates.description.trim();
    if (updates.filters !== undefined) updateDoc.filters = updates.filters;
    if (updates.ownerMapping !== undefined) updateDoc.ownerMapping = updates.ownerMapping;
    if (updates.pageSize !== undefined) updateDoc.pageSize = updates.pageSize;
    if (updates.enabled !== undefined) updateDoc.enabled = updates.enabled;

    await NotionIntegrationsCollection.updateAsync({ _id: integrationId }, { $set: updateDoc });
    return true;
  },

  /**
   * Remove a Notion integration
   */
  async 'notionIntegrations.remove'(integrationId) {
    check(integrationId, String);

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    await NotionIntegrationsCollection.removeAsync({ _id: integrationId });
    return true;
  },

  /**
   * Fetch tickets from Notion database using MCP
   * Returns paginated results
   */
  async 'notionIntegrations.fetchTickets'(integrationId, startCursor = null) {
    check(integrationId, String);
    check(startCursor, Match.Maybe(String));

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    if (!integration.enabled) {
      throw new Meteor.Error('disabled', 'This integration is disabled');
    }

    // Build Notion API filter based on integration config
    const filter = buildNotionFilter(integration.filters);

    // Call MCP Notion tool
    const queryParams = {
      database_id: integration.databaseId,
      page_size: integration.pageSize || 3
    };

    if (filter && Object.keys(filter).length > 0) {
      queryParams.filter = filter;
    }

    if (startCursor) {
      queryParams.start_cursor = startCursor;
    }

    // Find Notion MCP server configuration
    const { MCPServersCollection } = await import('../mcpServers/collections.js');
    const notionServer = await MCPServersCollection.findOneAsync({
      name: 'notion',
      enabled: true
    });

    if (!notionServer) {
      throw new Meteor.Error(
        'no-notion-server',
        'No Notion MCP server configured. Please add a Notion server in Preferences → MCP Servers.'
      );
    }

    // Call MCP Notion tool via generic MCP client
    let result;
    try {
      const { MCPClient } = await import('/imports/api/mcp/MCPClient.js');

      const mcpResult = await MCPClient.callTool(
        notionServer,
        'mcp__notion__API-post-database-query',
        queryParams,
        30000 // 30s timeout
      );

      // Extract result from MCP response format
      // MCP tools return { content: [{ type: 'text', text: '...' }] }
      result = mcpResult?.content?.[0]?.text;
      if (typeof result === 'string') {
        result = JSON.parse(result);
      }
    } catch (error) {
      console.error('[notionIntegrations.fetchTickets] MCP call failed:', error);
      throw new Meteor.Error('mcp-error', `Failed to fetch tickets: ${error.message}`);
    }

    // Update lastSyncAt
    await NotionIntegrationsCollection.updateAsync(
      { _id: integrationId },
      { $set: { lastSyncAt: new Date() } }
    );

    // Parse and format the results
    const tickets = parseNotionResults(result.results || [], integration.ownerMapping || {});

    return {
      tickets,
      has_more: result.has_more || false,
      next_cursor: result.next_cursor || null,
      syncedAt: new Date()
    };
  }
});

/**
 * Build Notion API filter from integration config
 */
function buildNotionFilter(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return null;
  }

  const conditions = [];

  // Squad name filter (rollup)
  if (filters.squadName) {
    conditions.push({
      property: 'Squad name',
      rollup: {
        any: {
          multi_select: {
            contains: filters.squadName
          }
        }
      }
    });
  }

  // Lifecycle filter (select)
  if (filters.lifecycle && Array.isArray(filters.lifecycle) && filters.lifecycle.length > 0) {
    if (filters.lifecycle.length === 1) {
      conditions.push({
        property: 'Lifecycle',
        select: {
          equals: filters.lifecycle[0]
        }
      });
    } else {
      conditions.push({
        or: filters.lifecycle.map(lc => ({
          property: 'Lifecycle',
          select: {
            equals: lc
          }
        }))
      });
    }
  }

  // Owner filter (people)
  if (filters.ownerIds && Array.isArray(filters.ownerIds) && filters.ownerIds.length > 0) {
    if (filters.ownerIds.length === 1) {
      conditions.push({
        property: 'Owner',
        people: {
          contains: filters.ownerIds[0]
        }
      });
    } else {
      conditions.push({
        or: filters.ownerIds.map(ownerId => ({
          property: 'Owner',
          people: {
            contains: ownerId
          }
        }))
      });
    }
  }

  if (conditions.length === 0) {
    return null;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return { and: conditions };
}

/**
 * Parse Notion API results into simplified ticket objects
 */
function parseNotionResults(results, ownerMapping) {
  return results.map(page => {
    const props = page.properties || {};

    // Extract ID
    const id = props.ID?.unique_id?.number || null;

    // Extract title
    const titleArray = props.Title?.title || [];
    const title = titleArray.map(t => t.plain_text || '').join('');

    // Extract owner
    const ownerArray = props.Owner?.people || [];
    const owners = ownerArray.map(person => {
      const userId = person.id;
      const displayName = ownerMapping[userId] || person.name || userId;
      return { id: userId, name: displayName };
    });

    // Extract age
    const ageFormula = props.Age?.formula?.string || '';

    // Extract priority
    const priority = props.Priority?.select?.name || null;

    // Extract lifecycle
    const lifecycle = props.Lifecycle?.select?.name || null;

    // Extract next step
    const nextStepArray = props['Next Step']?.rich_text || [];
    const nextStep = nextStepArray.map(t => t.plain_text || '').join('');

    // Extract URL
    const url = page.url || null;

    return {
      notionId: page.id,
      id,
      title,
      owners,
      age: ageFormula,
      priority,
      lifecycle,
      nextStep,
      url
    };
  });
}
