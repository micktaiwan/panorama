import { Mongo } from 'meteor/mongo';
import { localDriver } from '/imports/api/_shared/localDriver';

const driverOptions = localDriver ? { _driver: localDriver } : {};

export const NotionTicketsCollection = new Mongo.Collection('notionTickets', driverOptions);

/**
 * Schema for Notion Tickets
 * Stores tickets fetched from Notion databases
 */
export const NOTION_TICKET_SCHEMA = {
  integrationId: {
    type: String,
    required: true,
    description: 'Reference to the Notion integration that fetched this ticket'
  },
  notionId: {
    type: String,
    required: true,
    description: 'Notion page ID (unique identifier from Notion API)'
  },
  id: {
    type: Number,
    optional: true,
    description: 'Numeric ID from Notion (if available)'
  },
  title: {
    type: String,
    defaultValue: '',
    description: 'Ticket title'
  },
  owners: {
    type: Array,
    defaultValue: [],
    description: 'Array of owners with {id, name}'
  },
  'owners.$': {
    type: Object,
    optional: true
  },
  'owners.$.id': {
    type: String
  },
  'owners.$.name': {
    type: String
  },
  age: {
    type: String,
    optional: true,
    description: 'Age string from Notion formula (e.g., "1286 days old")'
  },
  priority: {
    type: String,
    optional: true,
    description: 'Priority level'
  },
  lifecycle: {
    type: String,
    optional: true,
    description: 'Lifecycle status (e.g., "🔨 Ongoing", "🚚 Delivering")'
  },
  nextStep: {
    type: String,
    defaultValue: '',
    description: 'Next step description'
  },
  url: {
    type: String,
    optional: true,
    description: 'Notion page URL'
  },
  syncedAt: {
    type: Date,
    required: true,
    description: 'Timestamp of last sync from Notion'
  },
  createdAt: {
    type: Date,
    defaultValue: () => new Date(),
    description: 'First time this ticket was synced'
  },
  updatedAt: {
    type: Date,
    defaultValue: () => new Date(),
    description: 'Last time this ticket was updated'
  }
};

/**
 * Create indexes for efficient queries
 */
if (Meteor.isServer) {
  Meteor.startup(() => {
    // Unique index on integrationId + notionId (for upsert)
    NotionTicketsCollection.createIndexAsync({ integrationId: 1, notionId: 1 }, { unique: true });

    // Index on integrationId for fast filtering
    NotionTicketsCollection.createIndexAsync({ integrationId: 1 });

    // Index on syncedAt for sorting/cleanup
    NotionTicketsCollection.createIndexAsync({ syncedAt: -1 });
  });
}
