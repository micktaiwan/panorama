import { Meteor } from 'meteor/meteor';
import { NotionIntegrationsCollection } from './collections.js';

/**
 * Publish all Notion integrations
 * Single-user app, no user filtering needed
 */
Meteor.publish('notionIntegrations', function() {
  return NotionIntegrationsCollection.find({}, {
    sort: { createdAt: -1 }
  });
});
