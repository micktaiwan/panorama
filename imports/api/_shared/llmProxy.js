import { Meteor } from 'meteor/meteor';
import { getAIConfig, getAIConfigAsync } from '/imports/api/_shared/config';
import { providers } from '/imports/api/_shared/aiCore';

/**
 * LLM Proxy - Central routing for all AI calls
 * Routes chat and embedding requests to local (Ollama) or remote (OpenAI) providers
 * based on user preferences and health checks.
 */

// Cache for health check results (5 minute TTL)
const HEALTH_CACHE = {
  ollama: { result: null, timestamp: 0 },
  openai: { result: null, timestamp: 0 }
};

const HEALTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached health check result or perform fresh check
 */
async function getHealthCheck(provider) {
  const now = Date.now();
  const cached = HEALTH_CACHE[provider];
  
  if (cached?.result && (now - cached.timestamp) < HEALTH_CACHE_TTL) {
    return cached.result;
  }
  
  const result = await providers[provider].healthCheck();
  HEALTH_CACHE[provider] = { result, timestamp: now };
  return result;
}

/**
 * Determine which provider to use based on mode
 * NO AUTOMATIC SWITCHING - mode is strictly enforced
 */
async function selectProvider(routeOverride = null, userId = null) {
  const config = userId ? await getAIConfigAsync(userId) : getAIConfig();

  // Override takes precedence
  if (routeOverride === 'local') {
    return 'ollama';
  }
  if (routeOverride === 'remote') {
    return 'openai';
  }

  // Strict mode enforcement - no auto switching
  if (config.mode === 'local') {
    return 'ollama';
  }

  if (config.mode === 'remote') {
    return 'openai';
  }

  // Default to remote (safer for production)
  return 'openai';
}

/**
 * Chat completion with automatic provider selection
 */
export async function chatComplete({ system, messages, model, temperature, maxTokens, timeoutMs, route, tools, tool_choice, responseFormat, schema, userId } = {}) {
  const config = userId ? await getAIConfigAsync(userId) : getAIConfig();
  const provider = await selectProvider(route, userId);

  const options = {
    system,
    messages,
    model,
    temperature: temperature || config.temperature,
    maxTokens: maxTokens || config.maxTokens,
    timeoutMs: timeoutMs || config.timeoutMs,
    tools,
    tool_choice,
    responseFormat,
    schema,
    userId
  };

  return await providers[provider].chatComplete(options);
}

/**
 * Embedding generation with automatic provider selection
 */
export async function embed(texts, { model, timeoutMs, route, userId } = {}) {
  const config = userId ? await getAIConfigAsync(userId) : getAIConfig();
  const provider = await selectProvider(route, userId);

  const options = {
    model,
    timeoutMs: timeoutMs || config.timeoutMs,
    userId
  };

  return await providers[provider].embed(texts, options);
}

/**
 * Get health status for both providers
 */
export async function getHealthStatus() {
  const [localHealth, remoteHealth] = await Promise.all([
    getHealthCheck('ollama'),
    getHealthCheck('openai')
  ]);
  
  return {
    local: localHealth,
    remote: remoteHealth
  };
}

/**
 * Force refresh health check cache
 */
export function refreshHealthCache() {
  HEALTH_CACHE.ollama = { result: null, timestamp: 0 };
  HEALTH_CACHE.openai = { result: null, timestamp: 0 };
}

/**
 * Get current configuration
 */
export function getCurrentConfig() {
  return getAIConfig();
}

/**
 * Test a specific provider directly
 */
export async function testProvider(provider, { system, messages, texts } = {}) {
  if (!providers[provider]) {
    throw new Meteor.Error('invalid-provider', `Unknown provider: ${provider}`);
  }
  
  console.log(`[testProvider] Testing ${provider} with config:`, getAIConfig());
  
  const results = {};
  
  // Test chat if messages provided
  if (messages && messages.length > 0) {
    try {
      console.log(`[testProvider] Testing ${provider} chat...`);
      results.chat = await providers[provider].chatComplete({
        system,
        messages,
        temperature: 0.1,
        maxTokens: 100
      });
      console.log(`[testProvider] ${provider} chat test successful`);
    } catch (error) {
      console.error(`[testProvider] ${provider} chat test failed:`, error);
      throw error;
    }
  }
  
  // Test embeddings if texts provided
  if (texts && texts.length > 0) {
    try {
      console.log(`[testProvider] Testing ${provider} embeddings...`);
      results.embeddings = await providers[provider].embed(texts.slice(0, 2)); // Limit to 2 texts for testing
      console.log(`[testProvider] ${provider} embeddings test successful`);
    } catch (error) {
      console.error(`[testProvider] ${provider} embeddings test failed:`, error);
      throw error;
    }
  }
  
  return results;
}
