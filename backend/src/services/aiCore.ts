import { getOpenAiApiKey, getAIConfig } from './config.js';

// Normalized response from any provider
export interface ChatResponse {
  text: string;
  content: string;
  tool_calls: unknown[];
  usage: { total_tokens: number } | null;
  model: string;
  finishReason: string;
}

export interface EmbedResponse {
  vectors: number[][];
  model: string;
}

interface ChatOptions {
  system?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  responseFormat?: string;
  schema?: unknown;
}

interface EmbedOptions {
  model?: string;
  timeoutMs?: number;
}

interface HealthResult {
  ok: boolean;
  details: unknown;
}

interface Provider {
  chatComplete(options: ChatOptions): Promise<ChatResponse>;
  embed(texts: string[], options?: EmbedOptions): Promise<EmbedResponse>;
  healthCheck(): Promise<HealthResult>;
}

// Ollama (local)
const ollama: Provider = {
  async chatComplete(options) {
    const config = getAIConfig();
    const host = config.local.host;
    const modelName = options.model || config.local.chatModel;

    const allMessages = options.system
      ? [{ role: 'system', content: options.system }, ...options.messages]
      : options.messages;

    const payload: Record<string, unknown> = {
      model: modelName,
      messages: allMessages,
      stream: false,
      options: {
        temperature: options.temperature || config.temperature,
        num_predict: options.maxTokens || config.maxTokens,
      },
    };

    if (options.tools && (options.tools as unknown[]).length > 0) {
      payload.tools = options.tools;
      if (options.tool_choice) payload.tool_choice = options.tool_choice;
    }

    if (options.responseFormat === 'json') {
      payload.format = 'json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);

    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const message = data.message as Record<string, unknown> | undefined;
    return {
      text: String(message?.content || ''),
      content: String(message?.content || ''),
      tool_calls: (message?.tool_calls as unknown[]) || [],
      usage: data.eval_count ? { total_tokens: data.eval_count as number } : null,
      model: String(data.model || modelName),
      finishReason: data.done ? 'stop' : 'length',
    };
  },

  async embed(texts, options = {}) {
    const config = getAIConfig();
    const host = config.local.host;
    const modelName = options.model || config.local.embeddingModel;
    const textArray = Array.isArray(texts) ? texts : [texts];
    const vectors: number[][] = [];

    for (const text of textArray) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);

      const response = await fetch(`${host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, input: text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama embeddings failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      if (data.embeddings && Array.isArray(data.embeddings)) {
        vectors.push(...data.embeddings);
      } else if (data.embedding && Array.isArray(data.embedding)) {
        vectors.push(data.embedding);
      } else {
        throw new Error('Invalid embedding response from Ollama');
      }
    }

    return { vectors, model: modelName };
  },

  async healthCheck() {
    const config = getAIConfig();
    const host = config.local.host;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${host}/api/version`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return { ok: false, details: `HTTP ${response.status}` };
      const data = await response.json();
      return { ok: true, details: data };
    } catch (err) {
      clearTimeout(timeoutId);
      return { ok: false, details: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

// OpenAI (remote)
const openai: Provider = {
  async chatComplete(options) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Error('OpenAI API key missing');

    const config = getAIConfig();
    const modelName = options.model || config.remote.chatModel;

    const allMessages = options.system
      ? [{ role: 'system', content: options.system }, ...options.messages]
      : options.messages;

    const payload: Record<string, unknown> = {
      model: modelName,
      messages: allMessages,
      temperature: options.temperature || config.temperature,
      max_tokens: options.maxTokens || config.maxTokens,
    };

    if (options.tools && (options.tools as unknown[]).length > 0) {
      payload.tools = options.tools;
      if (options.tool_choice) payload.tool_choice = options.tool_choice;
    }

    if (options.responseFormat === 'json') {
      if (options.schema) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: { name: 'response', strict: false, schema: options.schema },
        };
      } else {
        payload.response_format = { type: 'json_object' };
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    return {
      text: String(message?.content || ''),
      content: String(message?.content || ''),
      tool_calls: (message?.tool_calls as unknown[]) || [],
      usage: (data.usage as { total_tokens: number }) || null,
      model: String(data.model || modelName),
      finishReason: String(choice?.finish_reason || 'stop'),
    };
  },

  async embed(texts, options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Error('OpenAI API key missing');

    const config = getAIConfig();
    const modelName = options.model || config.remote.embeddingModel;

    const textArray = Array.isArray(texts) ? texts : [texts];
    const cleaned = textArray
      .map(t => String(t || '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 0 && t.length <= 30000);

    if (cleaned.length === 0) {
      return { vectors: [], model: modelName };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: modelName, input: cleaned }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embeddings failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const items = data.data as Array<{ embedding: number[] }> | undefined;
    return {
      vectors: items?.map(d => d.embedding) || [],
      model: String(data.model || modelName),
    };
  },

  async healthCheck() {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) return { ok: false, details: 'API key missing' };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return { ok: false, details: `HTTP ${response.status}` };
      const data = await response.json();
      return { ok: true, details: data };
    } catch (err) {
      clearTimeout(timeoutId);
      return { ok: false, details: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export const providers: Record<string, Provider> = { ollama, openai };
