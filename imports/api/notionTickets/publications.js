import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { NotionTicketsCollection } from './collections.js';

/**
 * Publish Notion tickets for a specific integration
 * Single-user app, no user filtering needed
 */
Meteor.publish('notionTickets.byIntegration', function(integrationId) {
  check(integrationId, String);

  return NotionTicketsCollection.find(
    { integrationId },
    {
      sort: { syncedAt: -1 }, // Most recently synced first
      fields: {
        integrationId: 1,
        notionId: 1,
        id: 1,
        title: 1,
        owners: 1,
        age: 1,
        priority: 1,
        lifecycle: 1,
        nextStep: 1,
        url: 1,
        syncedAt: 1
      }
    }
  );
});

/**
 * Publish all tickets (for admin/debugging)
 */
Meteor.publish('notionTickets.all', function() {
  return NotionTicketsCollection.find({}, {
    sort: { syncedAt: -1 },
    limit: 1000 // Safety limit
  });
});
