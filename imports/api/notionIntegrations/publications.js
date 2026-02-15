import { Meteor } from 'meteor/meteor';
import { NotionIntegrationsCollection } from './collections.js';

/**
 * Publish Notion integrations for the current user
 */
Meteor.publish('notionIntegrations', function() {
  if (!this.userId) return this.ready();
  return NotionIntegrationsCollection.find({ userId: this.userId }, {
    sort: { createdAt: -1 }
  });
});
