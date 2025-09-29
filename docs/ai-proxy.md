# AI Proxy Architecture

## Overview

The AI Proxy system provides a unified interface for all AI operations (chat completions and embeddings) with automatic routing between local (Ollama) and remote (OpenAI) providers based on user preferences and health checks.

## Architecture

### Core Components

1. **LLM Proxy** (`imports/api/_shared/llmProxy.js`)
   - Central routing logic for all AI calls
   - Health check management with caching
   - Automatic fallback handling
   - Provider selection based on mode and health

2. **Providers** (`imports/api/_shared/aiCore.js`)
   - `ollama`: Local Ollama integration with Metal acceleration
   - `openai`: Remote OpenAI API integration
   - Normalized response format across providers

3. **Configuration** (`imports/api/_shared/config.js`)
   - Dynamic AI preferences management
   - Default values and validation
   - Integration with AppPreferences collection

4. **UI Integration** (`imports/ui/Preferences/Preferences.jsx`)
   - Comprehensive settings interface
   - Real-time health monitoring
   - Provider testing capabilities

## Configuration

### AI Preferences Schema

```javascript
{
  mode: 'local' | 'remote' | 'auto',        // Default: 'remote'
  fallback: 'none' | 'local' | 'remote',    // Default: 'local'
  timeoutMs: number,                        // Default: 30000
  maxTokens: number,                        // Default: 4000
  temperature: number,                      // Default: 0.7
  local: {
    host: string,                           // Default: 'http://127.0.0.1:11434'
    chatModel: string,                      // Default: 'llama3.1:8b-instruct'
    embeddingModel: string                  // Default: 'nomic-embed-text'
  },
  remote: {
    provider: 'openai',                     // Default: 'openai'
    chatModel: string,                      // Default: 'gpt-4o-mini'
    embeddingModel: string                  // Default: 'text-embedding-3-small'
  }
}
```

### OpenAI API Key

- Configure the key in Preferences → Secrets → "OpenAI API Key".
- The key is read by the server via `getOpenAiApiKey()` (order: AppPreferences → env vars → Meteor settings).
- The "Remote AI (OpenAI) → API Key" UI field is not used; keep Secrets as the single place to configure the key.

### Modes

- **Local**: Always use Ollama (offline-first)
- **Remote**: Always use OpenAI (requires API key)
- **Auto**: Use local if healthy, fallback to remote if configured

## Usage

### Chat Completions

```javascript
import { chatComplete } from '/imports/api/_shared/llmProxy';

const result = await chatComplete({
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Hello!' }],
  temperature: 0.7,
  maxTokens: 1000
});

console.log(result.text); // Generated response
```

### Embeddings

```javascript
import { embed } from '/imports/api/_shared/llmProxy';

const result = await embed(['Text to embed', 'Another text']);
console.log(result.vectors); // Array of embedding vectors
```

### Health Checks

```javascript
import { getHealthStatus } from '/imports/api/_shared/llmProxy';

const health = await getHealthStatus();
console.log(health.local.ok);   // true/false
console.log(health.remote.ok);  // true/false
```

## Server Methods

### `ai.healthcheck()`
Returns health status for both providers.

### `ai.testProvider(provider, options)`
Tests a specific provider with sample data.

### `ai.saveRemoteKey(apiKey)`
Securely stores OpenAI API key server-side.

### `ai.updatePreferences(preferences)`
Updates AI configuration preferences.

## Security

- API keys are never stored client-side
- All sensitive operations are server-side only
- Health checks are cached to prevent excessive API calls
- Input validation on all server methods

## Model Compatibility

### Local Models (Ollama)
- **Chat**: `llama3.1:8b-instruct`, `mistral:7b-instruct`
- **Embeddings**: `nomic-embed-text` (768 dims), `all-MiniLM-L6-v2` (384 dims)

### Remote Models (OpenAI)
- **Chat**: `gpt-4o-mini`, `gpt-4o`
- **Embeddings**: `text-embedding-3-small` (1536 dims), `text-embedding-3-large` (3072 dims)

## Vector Store Integration

The system automatically handles different embedding dimensions and collection naming:

- **Dynamic vector size detection** based on current model
- **Collection naming strategy**:
  - Remote mode: Uses base collection name (e.g., `panorama`)
  - Local mode: Uses model-specific collections (e.g., `panorama_nomic_embed_text_latest`)
- **Manual reindexing** required when switching models or AI modes
- **Fallback search** to `search.instant` when Qdrant is unavailable in local mode
- Qdrant collection management with proper dimensions

## Performance

- Health checks cached for 5 minutes
- Automatic timeout handling (30s default)
- Metal acceleration on Apple Silicon (M1/M2/M3)
- Efficient error handling without silent catches

## Migration from Direct OpenAI

All existing AI calls have been migrated:
- `imports/api/notes/aiMethods.js`
- `imports/api/projects/aiMethods.js`
- `imports/api/userLogs/aiMethods.js`
- `imports/api/search/vectorStore.js`

The legacy `openAiChat` function remains for backward compatibility.

## Troubleshooting

### Local Provider Issues
1. Ensure Ollama is running: `ollama serve`
2. Check model availability: `ollama list`
3. Verify health status in Preferences UI

### Remote Provider Issues
1. Verify API key is set correctly
2. Check network connectivity
3. Monitor rate limits and usage

### Vector Store Issues
1. Ensure Qdrant is running locally
2. Check vector dimensions match current model
3. Reindex if switching embedding models

## Future Enhancements

- Support for additional providers (Anthropic, Cohere)
- Streaming responses
- Custom model fine-tuning
- Advanced caching strategies
- Multi-modal support (images, audio)
