import { getAIConfig } from './config.js';
import { providers, type ChatResponse, type EmbedResponse } from './aiCore.js';

/**
 * LLM Proxy — Central routing for all AI calls.
 * Routes to local (Ollama) or remote (OpenAI) based on config.
 * Strict mode: no automatic switching between providers.
 */

// Health check cache (5 min TTL)
const HEALTH_CACHE: Record<string, { result: unknown; timestamp: number }> = {
  ollama: { result: null, timestamp: 0 },
  openai: { result: null, timestamp: 0 },
};
const HEALTH_CACHE_TTL = 5 * 60 * 1000;

async function getHealthCheck(provider: string) {
  const now = Date.now();
  const cached = HEALTH_CACHE[provider];

  if (cached?.result && (now - cached.timestamp) < HEALTH_CACHE_TTL) {
    return cached.result;
  }

  const result = await providers[provider].healthCheck();
  HEALTH_CACHE[provider] = { result, timestamp: now };
  return result;
}

function selectProvider(routeOverride: string | null = null): string {
  const config = getAIConfig();

  if (routeOverride === 'local') return 'ollama';
  if (routeOverride === 'remote') return 'openai';
  if (config.mode === 'local') return 'ollama';
  if (config.mode === 'remote') return 'openai';

  return 'openai'; // default
}

interface ChatOptions {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  route?: string;
  tools?: unknown[];
  tool_choice?: unknown;
  responseFormat?: string;
  schema?: unknown;
}

export async function chatComplete(options: ChatOptions): Promise<ChatResponse> {
  const config = getAIConfig();
  const provider = selectProvider(options.route || null);

  return providers[provider].chatComplete({
    system: options.system,
    messages: options.messages,
    model: options.model,
    temperature: options.temperature || config.temperature,
    maxTokens: options.maxTokens || config.maxTokens,
    timeoutMs: options.timeoutMs || config.timeoutMs,
    tools: options.tools,
    tool_choice: options.tool_choice,
    responseFormat: options.responseFormat,
    schema: options.schema,
  });
}

export async function embed(
  texts: string[],
  options: { model?: string; timeoutMs?: number; route?: string } = {}
): Promise<EmbedResponse> {
  const config = getAIConfig();
  const provider = selectProvider(options.route || null);

  return providers[provider].embed(texts, {
    model: options.model,
    timeoutMs: options.timeoutMs || config.timeoutMs,
  });
}

export async function getHealthStatus() {
  const [localHealth, remoteHealth] = await Promise.all([
    getHealthCheck('ollama'),
    getHealthCheck('openai'),
  ]);

  return { local: localHealth, remote: remoteHealth };
}

export function refreshHealthCache() {
  HEALTH_CACHE.ollama = { result: null, timestamp: 0 };
  HEALTH_CACHE.openai = { result: null, timestamp: 0 };
}

export function getCurrentConfig() {
  return getAIConfig();
}
