import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey, getAIConfig } from '/imports/api/_shared/config';

// Normalize multi-line text to a single line
export const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Shared helpers for AI calls
export const OPENAI_MODEL = 'o4-mini';

const pad2 = (n) => String(n).padStart(2, '0');

export const localIsoWithOffset = (d) => {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${hh}:${mm}`;
};

export const formatAnchors = (now, since) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const nowLocalIso = localIsoWithOffset(now);
  const sinceLocalIso = localIsoWithOffset(since);
  const startLocal = `${pad2(since.getHours())}:${pad2(since.getMinutes())}`;
  const endLocal = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return { tz, sinceLocalIso, nowLocalIso, startLocal, endLocal };
};

export const buildEntriesBlock = (logs) => (logs || []).map(l => {
  const iso = new Date(l.createdAt).toISOString();
  return `- { id: ${l._id} } [${iso}] ${toOneLine(l.content || '')}`;
}).join('\n');

export const buildProjectsBlock = (catalog) => catalog.map(p => {
  const desc = p.description ? `, desc: ${p.description}` : '';
  return `- { id: ${p.id}, name: ${p.name}${desc} }`;
}).join('\n');

// AI Providers
export const providers = {
  ollama: {
    async chatComplete({ system, messages, model, temperature, maxTokens, timeoutMs = 30000, tools, tool_choice, responseFormat, schema } = {}) {
      const config = getAIConfig();
      const host = config.local.host;
      const modelName = model || config.local.chatModel;
      
      console.log(`[ollama.chatComplete] Using host: ${host}, model: ${modelName}`);
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
      
      // Build request payload
      const payload = {
        model: modelName,
        messages: allMessages,
        stream: false,
        options: {
          temperature: temperature || config.temperature,
          num_predict: maxTokens || config.maxTokens
        }
      };
      
      // Add tools support if provided
      if (tools && tools.length > 0) {
        payload.tools = tools;
        if (tool_choice) {
          payload.tool_choice = tool_choice;
        }
      }
      
      // Add response format if provided
      if (responseFormat === 'json') {
        payload.format = 'json';
        // Add schema if provided (Ollama supports JSON schema)
        if (schema) {
          payload.options = payload.options || {};
          payload.options.json_schema = schema;
        }
      }
      
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ollama.chatComplete] Request failed: ${response.status} ${errorText}`);
        throw new Meteor.Error('ollama-failed', `Ollama request failed: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      return {
        text: data.message?.content || '',
        content: data.message?.content || '', // Alias for compatibility
        tool_calls: data.message?.tool_calls || [],
        usage: data.eval_count ? { total_tokens: data.eval_count } : null,
        model: data.model || modelName,
        finishReason: data.done ? 'stop' : 'length'
      };
    },

    async embed(texts, { model, timeoutMs = 30000 } = {}) {
      const config = getAIConfig();
      const host = config.local.host;
      const modelName = model || config.local.embeddingModel;
      
      // Ollama only processes one text at a time, so we'll process them sequentially
      const textArray = Array.isArray(texts) ? texts : [texts];
      const vectors = [];
      
      for (const text of textArray) {
        const { default: fetch } = await import('node-fetch');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(`${host}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            input: text
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Meteor.Error('ollama-embed-failed', `Ollama embeddings failed: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        
        // Ollama returns {embeddings: [...]} directly, not {data: [{embedding: [...]}]}
        if (data.embeddings && Array.isArray(data.embeddings)) {
          vectors.push(...data.embeddings);
        } else if (data.embedding && Array.isArray(data.embedding)) {
          vectors.push(data.embedding);
        } else if (data.data && Array.isArray(data.data)) {
          vectors.push(...data.data.map(d => d.embedding).filter(Boolean));
        } else {
          console.error('[Ollama embed] Unexpected response format:', data);
          throw new Meteor.Error('ollama-embed-invalid', 'Invalid embedding response from Ollama');
        }
      }
      
      return {
        vectors,
        model: modelName
      };
    },

    async healthCheck() {
      const config = getAIConfig();
      const host = config.local.host;
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${host}/api/version`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return { ok: false, details: `HTTP ${response.status}` };
      }
      
      const data = await response.json();
      return { ok: true, details: data };
    }
  },

  openai: {
    async chatComplete({ system, messages, model, temperature, maxTokens, timeoutMs = 30000, tools, tool_choice, responseFormat, schema } = {}) {
      const apiKey = getOpenAiApiKey();
      if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
      
      const config = getAIConfig();
      const modelName = model || config.remote.chatModel;
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
      
      // Build request payload
      const payload = {
        model: modelName,
        messages: allMessages,
        temperature: temperature || config.temperature,
        max_tokens: maxTokens || config.maxTokens
      };
      
      // Add tools support if provided
      if (tools && tools.length > 0) {
        payload.tools = tools;
        if (tool_choice) {
          payload.tool_choice = tool_choice;
        }
      }
      
      // Add response format if provided
      if (responseFormat === 'json') {
        if (schema) {
          payload.response_format = { 
            type: 'json_schema', 
            json_schema: { 
              name: 'userlog_summary', 
              strict: false, 
              schema 
            } 
          };
        } else {
          payload.response_format = { type: 'json_object' };
        }
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${apiKey}` 
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Meteor.Error('openai-failed', `OpenAI request failed: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      const choice = data.choices?.[0];
      return {
        text: choice?.message?.content || '',
        content: choice?.message?.content || '', // Alias for compatibility
        tool_calls: choice?.message?.tool_calls || [],
        usage: data.usage || null,
        model: data.model || modelName,
        finishReason: choice?.finish_reason || 'stop'
      };
    },

    async embed(texts, { model, timeoutMs = 30000 } = {}) {
      const apiKey = getOpenAiApiKey();
      if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
      
      const config = getAIConfig();
      const modelName = model || config.remote.embeddingModel;
      
      // Clean and validate input texts
      const textArray = Array.isArray(texts) ? texts : [texts];
      const cleanedTexts = textArray.map(text => {
        if (!text || typeof text !== 'string') {
          return '';
        }
        // Clean text: normalize whitespace and remove problematic characters
        let cleaned = String(text);
        // Remove non-printable characters except spaces, tabs, and newlines
        cleaned = cleaned.replace(/[^\x20-\x7E\s]/g, '');
        // Normalize whitespace
        cleaned = cleaned.replace(/\s+/g, ' ');
        return cleaned.trim();
      }).filter(text => text.length > 0); // Remove empty strings
      
      if (cleanedTexts.length === 0) {
        // Return empty vectors array instead of throwing error for empty texts
        return {
          vectors: [],
          model: modelName
        };
      }
      
      // Check text length limits (OpenAI has a limit of ~8192 tokens, roughly 32000 characters)
      const maxLength = 30000;
      const validTexts = cleanedTexts.filter(text => text.length <= maxLength);
      
      if (validTexts.length === 0) {
        throw new Meteor.Error('openai-embed-too-long', 'All texts exceed maximum length for embedding');
      }
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${apiKey}` 
        },
        body: JSON.stringify({
          model: modelName,
          input: validTexts
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Meteor.Error('openai-embed-failed', `OpenAI embeddings failed: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      return {
        vectors: data.data?.map(d => d.embedding) || [],
        model: data.model || modelName
      };
    },

    async healthCheck() {
      const apiKey = getOpenAiApiKey();
      if (!apiKey) {
        return { ok: false, details: 'API key missing' };
      }
      
      const { default: fetch } = await import('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return { ok: false, details: `HTTP ${response.status}` };
      }
      
      const data = await response.json();
      return { ok: true, details: data };
    }
  }
};

// Legacy function for backward compatibility
export async function openAiChat({ system, user, expectJson, schema }) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
  const { default: fetch } = await import('node-fetch');
  const body = expectJson
    ? { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], response_format: { type: 'json_schema', json_schema: { name: 'userlog_summary', strict: false, schema } } }
    : { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ] };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[openAiChat] request failed', { status: resp.status, statusText: resp.statusText, body: errText });
    throw new Meteor.Error('openai-failed', errText);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || (expectJson ? '{}' : '');
  if (!expectJson) return String(content || '');
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error('[openAiChat] invalid JSON', { content, error: err?.message });
    throw new Meteor.Error('openai-invalid-json', 'Invalid JSON content from model');
  }
}
