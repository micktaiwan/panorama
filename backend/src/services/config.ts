// AI & infrastructure configuration
// Resolved from: env vars → safe defaults

export interface AIConfig {
  mode: 'local' | 'remote';
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  local: {
    host: string;
    chatModel: string;
    embeddingModel: string;
  };
  remote: {
    provider: string;
    chatModel: string;
    embeddingModel: string;
  };
}

const DEFAULTS: AIConfig = {
  mode: 'remote',
  timeoutMs: 30000,
  maxTokens: 4000,
  temperature: 0.7,
  local: {
    host: 'http://127.0.0.1:11434',
    chatModel: 'llama3.1:latest',
    embeddingModel: 'nomic-embed-text:latest',
  },
  remote: {
    provider: 'openai',
    chatModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
  },
};

export function getAIConfig(): AIConfig {
  return {
    mode: (process.env.AI_MODE as AIConfig['mode']) || DEFAULTS.mode,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || DEFAULTS.timeoutMs,
    maxTokens: Number(process.env.AI_MAX_TOKENS) || DEFAULTS.maxTokens,
    temperature: Number(process.env.AI_TEMPERATURE) || DEFAULTS.temperature,
    local: {
      host: process.env.OLLAMA_HOST || DEFAULTS.local.host,
      chatModel: process.env.OLLAMA_CHAT_MODEL || DEFAULTS.local.chatModel,
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || DEFAULTS.local.embeddingModel,
    },
    remote: {
      provider: DEFAULTS.remote.provider,
      chatModel: process.env.OPENAI_CHAT_MODEL || DEFAULTS.remote.chatModel,
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || DEFAULTS.remote.embeddingModel,
    },
  };
}

export function getOpenAiApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

export function getQdrantUrl(): string | null {
  return process.env.QDRANT_URL?.trim() || null;
}
