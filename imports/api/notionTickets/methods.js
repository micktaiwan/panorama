import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { NotionTicketsCollection } from './collections.js';
import { ensureLocalOnly } from '/imports/api/_shared/auth';

/**
 * Meteor methods for Notion Tickets
 */

Meteor.methods({
  /**
   * Upsert a single ticket
   * Updates if exists (by integrationId + notionId), inserts if new
   */
  async 'notionTickets.upsert'(integrationId, ticket) {
    check(integrationId, String);
    check(ticket, {
      notionId: String,
      id: Match.Optional(Number),
      title: String,
      owners: Array,
      age: Match.Optional(String),
      priority: Match.Optional(String),
      lifecycle: Match.Optional(String),
      nextStep: String,
      url: Match.Optional(String)
    });
    ensureLocalOnly();

    const now = new Date();

    // Prepare document
    const doc = {
      integrationId,
      notionId: ticket.notionId,
      id: ticket.id || null,
      title: ticket.title || '',
      owners: ticket.owners || [],
      age: ticket.age || null,
      priority: ticket.priority || null,
      lifecycle: ticket.lifecycle || null,
      nextStep: ticket.nextStep || '',
      url: ticket.url || null,
      syncedAt: now,
      updatedAt: now
    };

    // Upsert (update if exists, insert if new)
    const result = await NotionTicketsCollection.updateAsync(
      { integrationId, notionId: ticket.notionId },
      {
        $set: doc,
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    return result;
  },

  /**
   * Bulk upsert tickets
   * More efficient for upserting multiple tickets at once
   */
  async 'notionTickets.bulkUpsert'(integrationId, tickets) {
    check(integrationId, String);
    check(tickets, Array);
    ensureLocalOnly();

    const now = new Date();
    let insertedCount = 0;
    let updatedCount = 0;

    for (const ticket of tickets) {
      const doc = {
        integrationId,
        notionId: ticket.notionId,
        id: ticket.id || null,
        title: ticket.title || '',
        owners: ticket.owners || [],
        age: ticket.age || null,
        priority: ticket.priority || null,
        lifecycle: ticket.lifecycle || null,
        nextStep: ticket.nextStep || '',
        url: ticket.url || null,
        syncedAt: now,
        updatedAt: now
      };

      const result = await NotionTicketsCollection.updateAsync(
        { integrationId, notionId: ticket.notionId },
        {
          $set: doc,
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );

      if (result.insertedId) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }

    return { insertedCount, updatedCount, total: tickets.length };
  },

  /**
   * Clear all tickets for a specific integration
   */
  async 'notionTickets.clearByIntegration'(integrationId) {
    check(integrationId, String);
    ensureLocalOnly();

    const result = await NotionTicketsCollection.removeAsync({ integrationId });
    return { deletedCount: result };
  },

  /**
   * Get ticket count for an integration
   */
  async 'notionTickets.countByIntegration'(integrationId) {
    check(integrationId, String);
    ensureLocalOnly();

    const count = await NotionTicketsCollection.countDocuments({ integrationId });
    return count;
  },

  /**
   * Delete old tickets (cleanup)
   * Removes tickets that haven't been synced for X days
   */
  async 'notionTickets.deleteOld'(daysOld = 30) {
    check(daysOld, Number);
    ensureLocalOnly();

    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysOld);

    const result = await NotionTicketsCollection.removeAsync({
      syncedAt: { $lt: threshold }
    });

    return { deletedCount: result };
  }
});
