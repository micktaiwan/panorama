import React from 'react';
import { Meteor } from 'meteor/meteor';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import { notify } from '../utils/notify.js';

export const PrefsAI = ({ pref: _pref, userPref }) => {
  const [aiMode, setAiMode] = React.useState('remote');
  const [aiTimeoutMs, setAiTimeoutMs] = React.useState(30000);
  const [aiMaxTokens, setAiMaxTokens] = React.useState(4000);
  const [aiTemperature, setAiTemperature] = React.useState(0.7);
  const [aiLocalHost, setAiLocalHost] = React.useState('http://127.0.0.1:11434');
  const [aiLocalChatModel, setAiLocalChatModel] = React.useState('llama3.1:latest');
  const [aiLocalEmbeddingModel, setAiLocalEmbeddingModel] = React.useState('nomic-embed-text:latest');
  const [aiRemoteChatModel, setAiRemoteChatModel] = React.useState('gpt-4o-mini');
  const [aiRemoteEmbeddingModel, setAiRemoteEmbeddingModel] = React.useState('text-embedding-3-small');
  const [ctaEnabled, setCtaEnabled] = React.useState(true);
  const [ctaModel, setCtaModel] = React.useState('local');
  const [aiHealthStatus, setAiHealthStatus] = React.useState(null);
  const [aiTesting, setAiTesting] = React.useState({ ollama: false, openai: false });
  const [ollamaModels, setOllamaModels] = React.useState([]);
  const [loadingModels, setLoadingModels] = React.useState(false);

  React.useEffect(() => {
    if (!userPref) return;
    setAiMode(userPref.ai?.mode || 'remote');
    setAiTimeoutMs(userPref.ai?.timeoutMs || 30000);
    setAiMaxTokens(userPref.ai?.maxTokens || 4000);
    setAiTemperature(userPref.ai?.temperature || 0.7);
    setAiLocalHost(userPref.ai?.local?.host || 'http://127.0.0.1:11434');
    setAiLocalChatModel(userPref.ai?.local?.chatModel || 'llama3.1:latest');
    setAiLocalEmbeddingModel(userPref.ai?.local?.embeddingModel || 'nomic-embed-text:latest');
    setAiRemoteChatModel(userPref.ai?.remote?.chatModel || 'gpt-4o-mini');
    setAiRemoteEmbeddingModel(userPref.ai?.remote?.embeddingModel || 'text-embedding-3-small');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPref?._id, JSON.stringify(userPref?.ai)]);

  React.useEffect(() => {
    if (!userPref) return;
    if (userPref.cta) {
      setCtaEnabled(userPref.cta.enabled !== false);
      setCtaModel(userPref.cta.model || 'local');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPref?._id, JSON.stringify(userPref?.cta)]);

  const generateAIPreferences = React.useCallback(() => ({
    mode: aiMode,
    timeoutMs: aiTimeoutMs,
    maxTokens: aiMaxTokens,
    temperature: aiTemperature,
    local: { host: aiLocalHost, chatModel: aiLocalChatModel, embeddingModel: aiLocalEmbeddingModel },
    remote: { chatModel: aiRemoteChatModel, embeddingModel: aiRemoteEmbeddingModel }
  }), [aiMode, aiTimeoutMs, aiMaxTokens, aiTemperature, aiLocalHost, aiLocalChatModel, aiLocalEmbeddingModel, aiRemoteChatModel, aiRemoteEmbeddingModel]);

  const saveAIPreferences = React.useCallback((showNotification = true) => {
    Meteor.call('userPreferences.update', { ai: generateAIPreferences() }, (err) => {
      if (err) {
        if (showNotification) notify({ message: `Failed to save AI preferences: ${err.reason || err.message}`, kind: 'error' });
        else console.error('Auto-save failed:', err);
        return;
      }
      if (showNotification) notify({ message: 'AI preferences saved successfully', kind: 'success' });
    });
  }, [generateAIPreferences]);

  const debouncedAutoSave = React.useMemo(() => {
    let timeoutId;
    return () => { clearTimeout(timeoutId); timeoutId = setTimeout(() => saveAIPreferences(false), 500); };
  }, [saveAIPreferences]);

  React.useEffect(() => {
    if (aiMode && userPref && aiMode !== userPref.ai?.mode) debouncedAutoSave();
  }, [aiMode, debouncedAutoSave, userPref]);

  React.useEffect(() => {
    if (aiLocalEmbeddingModel && userPref && aiLocalEmbeddingModel !== userPref.ai?.local?.embeddingModel) debouncedAutoSave();
  }, [aiLocalEmbeddingModel, debouncedAutoSave, userPref]);

  React.useEffect(() => {
    if (aiTimeoutMs && userPref && aiTimeoutMs !== userPref.ai?.timeoutMs) debouncedAutoSave();
  }, [aiTimeoutMs, debouncedAutoSave, userPref]);

  React.useEffect(() => {
    if (aiMaxTokens && userPref && aiMaxTokens !== userPref.ai?.maxTokens) debouncedAutoSave();
  }, [aiMaxTokens, debouncedAutoSave, userPref]);

  React.useEffect(() => {
    if (aiTemperature !== undefined && userPref && aiTemperature !== userPref.ai?.temperature) debouncedAutoSave();
  }, [aiTemperature, debouncedAutoSave, userPref]);

  const checkAIHealth = React.useCallback(() => {
    Meteor.call('ai.healthcheck', (err, result) => {
      if (err) { setAiHealthStatus(null); notify({ message: `AI health check failed: ${err.reason || err.message}`, kind: 'error' }); }
      else { setAiHealthStatus(result); notify({ message: 'AI health status updated', kind: 'success' }); }
    });
  }, []);

  const loadOllamaModels = React.useCallback(() => {
    setLoadingModels(true);
    Meteor.call('ai.listOllamaModels', (err, result) => {
      setLoadingModels(false);
      if (err) notify({ message: `Failed to load Ollama models: ${err.reason || err.message}`, kind: 'error' });
      else setOllamaModels(result.models || []);
    });
  }, []);

  React.useEffect(() => { loadOllamaModels(); }, [loadOllamaModels]);

  const testAIProvider = React.useCallback((provider) => {
    setAiTesting(prev => ({ ...prev, [provider]: true }));
    Meteor.call('ai.testProvider', provider, {
      messages: [{ role: 'user', content: 'Hello, this is a test message.' }],
      texts: ['Test embedding text']
    }, (err) => {
      setAiTesting(prev => ({ ...prev, [provider]: false }));
      if (err) notify({ message: `${provider} test failed: ${err.reason || err.message}`, kind: 'error' });
      else notify({ message: `${provider} test successful`, kind: 'success' });
    });
  }, []);

  return (
    <>
      <h2>AI Backend</h2>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Mode</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={aiMode}
              options={[
                { value: 'local', label: 'Local (Ollama)' },
                { value: 'remote', label: 'Remote (OpenAI)' }
              ]}
              onSubmit={(next) => setAiMode(next)}
            />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Routes all AI calls (summaries, analysis, embeddings) to the selected provider
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Timeout (ms)</div>
          <div className="prefsValue">
            <InlineEditable value={aiTimeoutMs.toString()} onSubmit={(next) => setAiTimeoutMs(parseInt(next) || 30000)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Max wait time for each AI request before aborting
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Max Tokens</div>
          <div className="prefsValue">
            <InlineEditable value={aiMaxTokens.toString()} onSubmit={(next) => setAiMaxTokens(parseInt(next) || 4000)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Default max response length for AI calls (some features override this)
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Temperature</div>
          <div className="prefsValue">
            <InlineEditable value={aiTemperature.toString()} onSubmit={(next) => setAiTemperature(parseFloat(next) || 0.7)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Default creativity level (0 = deterministic, 1 = creative). Some features override this.
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Health Status</div>
          <div className="prefsValue">
            <button className="btn" onClick={checkAIHealth} style={{ marginRight: '8px' }}>Check Health</button>
            {aiHealthStatus ? (
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <span style={{ color: aiHealthStatus.local?.ok ? 'var(--success)' : 'var(--error)' }}>
                  Local: {aiHealthStatus.local?.ok ? 'OK' : 'Down'}
                </span>
                <span style={{ color: aiHealthStatus.remote?.ok ? 'var(--success)' : 'var(--error)' }}>
                  Remote: {aiHealthStatus.remote?.ok ? 'OK' : 'Down'}
                </span>
              </div>
            ) : (
              <span style={{ color: 'var(--muted)', marginTop: '8px', display: 'block' }}>No status available</span>
            )}
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Actions</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => testAIProvider('ollama')} disabled={aiTesting.ollama} style={{ marginRight: '8px' }}>
              {aiTesting.ollama ? 'Testing...' : 'Test Local'}
            </button>
            <button className="btn" onClick={() => testAIProvider('openai')} disabled={aiTesting.openai}>
              {aiTesting.openai ? 'Testing...' : 'Test Remote'}
            </button>
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Sends a test chat + embedding request to verify connectivity
            </div>
          </div>
        </div>
      </div>

      <h3>Local AI (Ollama)</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Host</div>
          <div className="prefsValue">
            <InlineEditable value={aiLocalHost} fullWidth onSubmit={(next) => setAiLocalHost(next)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Ollama server URL (local or via SSH tunnel)
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Chat Model</div>
          <div className="prefsValue">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={aiLocalChatModel}
                onChange={(e) => setAiLocalChatModel(e.target.value)}
                style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="">Select a model...</option>
                {ollamaModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} {model.parameterSize ? `(${model.parameterSize})` : ''}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={loadOllamaModels} disabled={loadingModels} style={{ padding: '4px 8px', fontSize: '12px' }}>
                {loadingModels ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Used for summaries, analysis, and all chat-based AI features in local mode
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Embedding Model</div>
          <div className="prefsValue">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={aiLocalEmbeddingModel}
                onChange={(e) => setAiLocalEmbeddingModel(e.target.value)}
                style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                <option value="">Select a model...</option>
                {ollamaModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} {model.parameterSize ? `(${model.parameterSize})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              Used for Qdrant semantic search indexing. Changing model requires a full reindex.
            </div>
          </div>
        </div>
      </div>

      <h3>Remote AI (OpenAI)</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">API Key</div>
          <div className="prefsValue">
            <span style={{ color: 'var(--muted)' }}>
              Configurez la clé OpenAI dans l'onglet « Secrets ».
            </span>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Chat Model</div>
          <div className="prefsValue">
            <InlineEditable value={aiRemoteChatModel} fullWidth onSubmit={(next) => setAiRemoteChatModel(next)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              OpenAI model for summaries, analysis, and all chat-based AI features in remote mode
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Embedding Model</div>
          <div className="prefsValue">
            <InlineEditable value={aiRemoteEmbeddingModel} fullWidth onSubmit={(next) => setAiRemoteEmbeddingModel(next)} />
            <div className="muted mt4" style={{ fontSize: '12px' }}>
              OpenAI model for Qdrant semantic search indexing. Changing model requires a full reindex.
            </div>
          </div>
        </div>
      </div>

      <h3 style={{ color: 'var(--muted)' }}>Email CTA Suggestions <span style={{ fontSize: '12px', fontWeight: 'normal' }}>Deprecated</span></h3>
      <div className="prefsSection" style={{ opacity: 0.5, pointerEvents: 'none' }}>
        <div className="prefsRow">
          <div className="prefsLabel">Enable CTA Suggestions</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={ctaEnabled ? 'true' : 'false'}
              options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]}
              onSubmit={(next) => {
                const enabled = next === 'true';
                setCtaEnabled(enabled);
                Meteor.call('userPreferences.update', { cta: { enabled, model: ctaModel } }, () => {});
              }}
            />
          </div>
        </div>
        {ctaEnabled && (
          <div className="prefsRow">
            <div className="prefsLabel">Model for CTA Suggestions</div>
            <div className="prefsValue">
              <InlineEditable
                as="select"
                value={ctaModel}
                options={[
                  { value: 'local', label: 'Local (Ollama)' },
                  { value: 'remote', label: 'Remote (OpenAI)' }
                ]}
                onSubmit={(next) => {
                  setCtaModel(next);
                  Meteor.call('userPreferences.update', { cta: { enabled: ctaEnabled, model: next } }, () => {});
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
