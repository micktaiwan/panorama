import { Mongo } from 'meteor/mongo';

export const AppPreferencesCollection = new Mongo.Collection('appPreferences');

// Schema for AI preferences
export const AI_PREFERENCES_SCHEMA = {
  mode: {
    type: String,
    allowedValues: ['local', 'remote'],
    defaultValue: 'remote'
  },
  fallback: {
    type: String,
    allowedValues: ['none', 'local', 'remote'],
    defaultValue: 'none'
  },
  timeoutMs: {
    type: Number,
    defaultValue: 30000
  },
  maxTokens: {
    type: Number,
    defaultValue: 4000
  },
  temperature: {
    type: Number,
    defaultValue: 0.7
  },
  local: {
    type: Object,
    defaultValue: {
      host: 'http://127.0.0.1:11434',
      chatModel: 'llama3.1:latest',
      embeddingModel: 'nomic-embed-text:latest'
    }
  },
  remote: {
    type: Object,
    defaultValue: {
      provider: 'openai',
      chatModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small'
    }
  }
};

