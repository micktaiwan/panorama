import { Mongo } from 'meteor/mongo';

export const NotionIntegrationsCollection = new Mongo.Collection('notionIntegrations');

/**
 * Schema for Notion Integration configurations
 * Each document represents a connection to a Notion database
 */
export const NOTION_INTEGRATION_SCHEMA = {
  name: {
    type: String,
    required: true,
    description: 'Display name for this integration (e.g., "Stories - Squad Data")'
  },
  databaseId: {
    type: String,
    required: true,
    description: 'Notion database ID (without dashes)'
  },
  description: {
    type: String,
    optional: true,
    description: 'Optional description of what this integration tracks'
  },
  filters: {
    type: Object,
    optional: true,
    description: 'Pre-configured filters for this database',
    defaultValue: {}
  },
  'filters.squadName': {
    type: String,
    optional: true,
    description: 'Squad name to filter by (e.g., "Data")'
  },
  'filters.lifecycle': {
    type: Array,
    optional: true,
    description: 'Array of lifecycle values to include (e.g., ["🔨 Ongoing", "🚚 Delivering"])'
  },
  'filters.lifecycle.$': {
    type: String
  },
  'filters.ownerIds': {
    type: Array,
    optional: true,
    description: 'Array of Notion user IDs to filter by'
  },
  'filters.ownerIds.$': {
    type: String
  },
  ownerMapping: {
    type: Object,
    optional: true,
    description: 'Map of Notion user IDs to display names',
    defaultValue: {}
  },
  pageSize: {
    type: Number,
    defaultValue: 3,
    description: 'Number of items to fetch per page (recommended: 3 for Notion API)'
  },
  createdAt: {
    type: Date,
    defaultValue: () => new Date()
  },
  lastSyncAt: {
    type: Date,
    optional: true,
    description: 'Timestamp of last successful sync'
  },
  syncInProgress: {
    type: Boolean,
    optional: true,
    defaultValue: false,
    description: 'Whether a sync operation is currently running'
  },
  syncProgress: {
    type: Object,
    optional: true,
    description: 'Current sync progress information'
  },
  'syncProgress.current': {
    type: Number,
    optional: true,
    description: 'Number of tickets synced so far'
  },
  'syncProgress.pageCount': {
    type: Number,
    optional: true,
    description: 'Number of pages fetched so far'
  },
  'syncProgress.status': {
    type: String,
    optional: true,
    description: 'Current status message'
  },
  syncCancelRequested: {
    type: Boolean,
    optional: true,
    defaultValue: false,
    description: 'Whether user requested to cancel the current sync'
  },
  enabled: {
    type: Boolean,
    defaultValue: true,
    description: 'Whether this integration is active'
  }
};
