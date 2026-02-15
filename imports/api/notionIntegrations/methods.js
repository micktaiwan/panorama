import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { NotionIntegrationsCollection } from './collections.js';
import { ensureLocalOnly } from '/imports/api/_shared/auth';

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
    ensureLocalOnly();

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
    ensureLocalOnly();

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
    ensureLocalOnly();

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    await NotionIntegrationsCollection.removeAsync({ _id: integrationId });
    return true;
  },

  /**
   * Sync all tickets from Notion database
   * Automatically fetches all pages with progress tracking
   */
  async 'notionIntegrations.syncAll'(integrationId) {
    check(integrationId, String);
    ensureLocalOnly();

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    if (!integration.enabled) {
      throw new Meteor.Error('disabled', 'This integration is disabled');
    }

    if (integration.syncInProgress) {
      throw new Meteor.Error('sync-in-progress', 'A sync is already in progress for this integration');
    }

    // Mark sync as started
    await NotionIntegrationsCollection.updateAsync(
      { _id: integrationId },
      {
        $set: {
          syncInProgress: true,
          syncCancelRequested: false,
          syncProgress: {
            current: 0,
            pageCount: 0,
            status: 'Starting sync...'
          }
        }
      }
    );

    try {
      // Clear existing tickets (fresh start)
      await Meteor.callAsync('notionTickets.clearByIntegration', integrationId);

      // Fetch all pages
      let cursor = null;
      let hasMore = true;
      let totalTickets = 0;
      let pageCount = 0;
      const maxPages = 100; // Safety limit

      console.log('[notionIntegrations.syncAll] Starting sync for integration:', integrationId);
      console.log('[notionIntegrations.syncAll] Filters:', JSON.stringify(integration.filters, null, 2));

      while (hasMore) {
        // Check if cancel was requested
        const currentIntegration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
        if (currentIntegration?.syncCancelRequested) {
          await NotionIntegrationsCollection.updateAsync(
            { _id: integrationId },
            {
              $set: {
                syncInProgress: false,
                syncProgress: {
                  current: totalTickets,
                  pageCount,
                  status: 'Cancelled by user'
                }
              }
            }
          );
          throw new Meteor.Error('sync-cancelled', `Sync cancelled after ${totalTickets} tickets`);
        }

        // Fetch one page
        console.log(`[notionIntegrations.syncAll] Fetching page ${pageCount + 1} with cursor:`, cursor || 'null (first page)');
        const result = await Meteor.callAsync('notionIntegrations.fetchTicketsPage', integrationId, cursor);

        console.log(`[notionIntegrations.syncAll] Page ${pageCount + 1} result:`, {
          ticketsReceived: result.tickets.length,
          has_more: result.has_more,
          next_cursor: result.next_cursor ? `present (${result.next_cursor.substring(0, 8)}...)` : 'null'
        });

        totalTickets += result.tickets.length;
        pageCount++;
        hasMore = result.has_more;
        cursor = result.next_cursor;

        // Update progress
        await NotionIntegrationsCollection.updateAsync(
          { _id: integrationId },
          {
            $set: {
              syncProgress: {
                current: totalTickets,
                pageCount,
                status: `Syncing... ${totalTickets} tickets`
              }
            }
          }
        );

        // Safety limit
        if (pageCount >= maxPages) {
          console.warn('[notionIntegrations.syncAll] Reached safety limit of 100 pages');
          break;
        }
      }

      // Mark sync as complete
      const now = new Date();
      await NotionIntegrationsCollection.updateAsync(
        { _id: integrationId },
        {
          $set: {
            syncInProgress: false,
            lastSyncAt: now,
            syncProgress: {
              current: totalTickets,
              pageCount,
              status: 'Complete'
            }
          }
        }
      );

      return {
        totalTickets,
        pageCount,
        syncedAt: now
      };
    } catch (error) {
      // Mark sync as failed
      await NotionIntegrationsCollection.updateAsync(
        { _id: integrationId },
        {
          $set: {
            syncInProgress: false,
            syncProgress: {
              current: 0,
              pageCount: 0,
              status: `Error: ${error.message}`
            }
          }
        }
      );
      throw error;
    }
  },

  /**
   * Cancel an ongoing sync operation
   */
  async 'notionIntegrations.cancelSync'(integrationId) {
    check(integrationId, String);
    ensureLocalOnly();

    const integration = await NotionIntegrationsCollection.findOneAsync({ _id: integrationId });
    if (!integration) {
      throw new Meteor.Error('not-found', 'Integration not found');
    }

    if (!integration.syncInProgress) {
      throw new Meteor.Error('no-sync-in-progress', 'No sync is currently in progress');
    }

    // Request cancellation (the sync loop will check this flag)
    await NotionIntegrationsCollection.updateAsync(
      { _id: integrationId },
      { $set: { syncCancelRequested: true } }
    );

    return { success: true };
  },

  /**
   * Fetch a single page of tickets from Notion database using MCP
   * Internal method used by syncAll
   */
  async 'notionIntegrations.fetchTicketsPage'(integrationId, startCursor = null) {
    check(integrationId, String);
    check(startCursor, Match.Maybe(String));
    ensureLocalOnly();

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
      name: { $regex: /^notion$/i },
      enabled: true
    });

    if (!notionServer) {
      throw new Meteor.Error(
        'no-notion-server',
        'No Notion MCP server configured. Please add a Notion server in Preferences → MCP Servers.'
      );
    }

    console.log('[fetchTicketsPage] Calling Notion API with params:', {
      database_id: queryParams.database_id,
      page_size: queryParams.page_size,
      start_cursor: startCursor ? `${startCursor.substring(0, 8)}...` : 'null',
      filter: queryParams.filter ? 'present (see buildNotionFilter logs)' : 'none'
    });

    // Call MCP Notion tool
    const { MCPClient } = await import('/imports/api/mcp/MCPClient.js');

    let result;
    try {
      const mcpResult = await MCPClient.callTool(
        notionServer,
        'API-post-database-query', // Official Notion MCP server tool name
        queryParams,
        30000 // 30s timeout
      );

      // Extract result from MCP response format
      // MCP tools return { content: [{ type: 'text', text: '...' }] }
      result = mcpResult?.content?.[0]?.text;
      if (typeof result === 'string') {
        result = JSON.parse(result);
      }

      console.log('[fetchTicketsPage] Notion API response:', {
        resultsCount: result?.results?.length || 0,
        has_more: result?.has_more,
        next_cursor: result?.next_cursor ? `${result.next_cursor.substring(0, 8)}...` : 'null'
      });
    } catch (error) {
      console.error('[notionIntegrations.fetchTickets] MCP call failed:', error);
      throw new Meteor.Error('mcp-error', `Failed to fetch tickets: ${error.message}`);
    }

    // Parse and format the results
    const tickets = parseNotionResults(result.results || [], integration.ownerMapping || {});

    // Persist tickets to MongoDB (upsert)
    await Meteor.callAsync('notionTickets.bulkUpsert', integrationId, tickets);

    // Return page results (syncAll will handle lastSyncAt)
    return {
      tickets,
      has_more: result.has_more || false,
      next_cursor: result.next_cursor || null
    };
  }
});

/**
 * Build Notion API filter from integration config
 */
function buildNotionFilter(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    console.log('[buildNotionFilter] No filters provided');
    return null;
  }

  console.log('[buildNotionFilter] Building filter from:', JSON.stringify(filters, null, 2));

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
    console.log('[buildNotionFilter] No conditions built, returning null');
    return null;
  }

  const finalFilter = conditions.length === 1 ? conditions[0] : { and: conditions };
  console.log('[buildNotionFilter] Final Notion API filter:', JSON.stringify(finalFilter, null, 2));

  return finalFilter;
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
