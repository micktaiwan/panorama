import React from 'react';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { AppPreferencesCollection } from '../../api/appPreferences/collections';
import { InlineEditable } from '../InlineEditable/InlineEditable.jsx';
import './Preferences.css';
import { Modal } from '../components/Modal/Modal.jsx';
import { navigateTo } from '../router.js';
import { notify } from '../utils/notify.js';
import { playBeep } from '../utils/sound.js';

export const Preferences = () => {
  const sub = useSubscribe('appPreferences');
  const pref = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const [filesDir, setFilesDir] = React.useState('');
  const [devUrlMode, setDevUrlMode] = React.useState(false);
  const [openaiApiKey, setOpenaiApiKey] = React.useState('');
  const [perplexityApiKey, setPerplexityApiKey] = React.useState('');
  const [pennyBaseUrl, setPennyBaseUrl] = React.useState('');
  const [pennyToken, setPennyToken] = React.useState('');
  const [qdrantUrl, setQdrantUrl] = React.useState('');
  const [calendarIcsUrl, setCalendarIcsUrl] = React.useState('');
  const [health, setHealth] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const [indexing, setIndexing] = React.useState(false);
  const [confirmIndex, setConfirmIndex] = React.useState(false);
  const [selectedKind, setSelectedKind] = React.useState('task');
  const [rawLines, setRawLines] = React.useState(null);
  const [fetchingLines, setFetchingLines] = React.useState(false);
  // indexJob: { jobId, total, processed, upserts, errors, done }
  const [indexJob, setIndexJob] = React.useState(null);
  // removed local toast; using global notify manager
  const [mobileTasksEnabled, setMobileTasksEnabled] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem('panorama.mobileTasksEnabled');
      return raw == null ? true : String(raw) === 'true';
    } catch (e) {
      console.warn('[prefs] localStorage read failed for panorama.mobileTasksEnabled', e);
      return true;
    }
  });
  const [lanIp, setLanIp] = React.useState('');
  
  // AI Backend preferences
  const [aiMode, setAiMode] = React.useState('local');
  const [aiFallback, setAiFallback] = React.useState('remote');
  const [aiTimeoutMs, setAiTimeoutMs] = React.useState(30000);
  const [aiMaxTokens, setAiMaxTokens] = React.useState(4000);
  const [aiTemperature, setAiTemperature] = React.useState(0.7);
  const [aiLocalHost, setAiLocalHost] = React.useState('http://127.0.0.1:11434');
  const [aiLocalChatModel, setAiLocalChatModel] = React.useState('llama3.1:latest');
  const [aiLocalEmbeddingModel, setAiLocalEmbeddingModel] = React.useState('nomic-embed-text:latest');
  const [aiRemoteProvider, setAiRemoteProvider] = React.useState('openai');
  const [aiRemoteChatModel, setAiRemoteChatModel] = React.useState('gpt-4o-mini');
  const [aiRemoteEmbeddingModel, setAiRemoteEmbeddingModel] = React.useState('text-embedding-3-small');
  
  // Email CTA preferences
  const [ctaEnabled, setCtaEnabled] = React.useState(true);
  const [ctaModel, setCtaModel] = React.useState('local');
  const [aiHealthStatus, setAiHealthStatus] = React.useState(null);
  const [aiTesting, setAiTesting] = React.useState({ ollama: false, openai: false });
  const [ollamaModels, setOllamaModels] = React.useState([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  
  // Token counting state
  const [tokenStats, setTokenStats] = React.useState(null);
  const [countingTokens, setCountingTokens] = React.useState(false);

  // Ensure UI reflects actual server toggle on mount
  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getStatus', (err, res) => {
      if (err) {
        console.warn('[prefs] mobileTasksRoute.getStatus failed', err);
        return;
      }
      const sv = !!(res?.enabled);
      setMobileTasksEnabled(sv);
      try { window.localStorage.setItem('panorama.mobileTasksEnabled', String(sv)); } catch (e2) { console.warn('[prefs] localStorage write failed (sync from server)', e2); }
    });
  }, []);

  React.useEffect(() => {
    Meteor.call('mobileTasksRoute.getLanIps', (err, res) => {
      if (err) {
        console.warn('[prefs] getLanIps failed', err);
        setLanIp('');
        return;
      }
      const first = Array.isArray(res?.ips) && res.ips.length > 0 ? res.ips[0] : '';
      setLanIp(first);
    });
  }, []);

  // Load AI preferences on mount
  React.useEffect(() => {
    if (pref?.ai) {
      setAiMode(pref.ai.mode || 'local');
      setAiFallback(pref.ai.fallback || 'remote');
      setAiTimeoutMs(pref.ai.timeoutMs || 30000);
      setAiMaxTokens(pref.ai.maxTokens || 4000);
      setAiTemperature(pref.ai.temperature || 0.7);
      if (pref.ai.local) {
        setAiLocalHost(pref.ai.local.host || 'http://127.0.0.1:11434');
        setAiLocalChatModel(pref.ai.local.chatModel || 'llama3.1:latest');
        setAiLocalEmbeddingModel(pref.ai.local.embeddingModel || 'nomic-embed-text:latest');
      }
      if (pref.ai.remote) {
        setAiRemoteProvider(pref.ai.remote.provider || 'openai');
        setAiRemoteChatModel(pref.ai.remote.chatModel || 'gpt-4o-mini');
        setAiRemoteEmbeddingModel(pref.ai.remote.embeddingModel || 'text-embedding-3-small');
      }
      
      // Load CTA preferences
      if (pref.cta) {
        setCtaEnabled(pref.cta.enabled !== false);
        setCtaModel(pref.cta.model || 'local');
      }
      
      // Refresh Qdrant health to show correct collection name
      Meteor.call('qdrant.health', (err, res) => {
        if (!err && res) {
          setHealth(res);
        }
      });
    }
  }, [pref]);

  // Manual AI health check function
  const checkAIHealth = React.useCallback(() => {
    Meteor.call('ai.healthcheck', (err, result) => {
      if (err) {
        console.warn('[prefs] AI health check failed', err);
        setAiHealthStatus(null);
        notify({ 
          message: `AI health check failed: ${err.reason || err.message}`, 
          kind: 'error' 
        });
      } else {
        setAiHealthStatus(result);
        notify({ 
          message: 'AI health status updated', 
          kind: 'success' 
        });
      }
    });
  }, []);

  const loadOllamaModels = React.useCallback(() => {
    setLoadingModels(true);
    Meteor.call('ai.listOllamaModels', (err, result) => {
      setLoadingModels(false);
      if (err) {
        console.error('[loadOllamaModels] Failed to load models:', err);
        notify({
          message: `Failed to load Ollama models: ${err.reason || err.message}`,
          kind: 'error'
        });
      } else {
        setOllamaModels(result.models || []);
      }
    });
  }, []);

  // Load Ollama models on mount
  React.useEffect(() => {
    loadOllamaModels();
  }, [loadOllamaModels]);

  const pollIndexStatus = React.useCallback((jobId) => {
    Meteor.call('qdrant.indexStatus', jobId, (e2, st) => {
      if (e2 || !st) {
        setIndexing(false);
        setIndexJob(null);
        setHealth({ error: e2?.reason || e2?.message || 'status failed' });
        notify({ message: `Index status failed: ${e2?.reason || e2?.message || 'unknown error'}`, kind: 'error' });
        return;
      }
      setIndexJob({ ...st, jobId });
      if (st.done) {
        setIndexing(false);
        notify({ message: 'Index rebuild completed', kind: 'success' });
        Meteor.call('qdrant.health', (e3, r3) => setHealth(e3 ? { error: e3?.reason || e3?.message || String(e3) } : r3));
      } else {
        setTimeout(() => pollIndexStatus(jobId), 800);
      }
    });
  }, []);

  const startRebuild = React.useCallback(() => {
    setIndexing(true);
    Meteor.call('qdrant.indexStart', (err, res) => {
      if (err || !res) {
        setIndexing(false);
        setHealth({ error: err?.reason || err?.message || 'start failed' });
        notify({ message: `Index start failed: ${err?.reason || err?.message || 'unknown error'}`, kind: 'error' });
        return;
      }
      setIndexJob({ jobId: res.jobId, total: res.total, processed: 0, upserts: 0, errors: 0, done: false });
      pollIndexStatus(res.jobId);
    });
  }, [pollIndexStatus]);

  // AI test methods
  const testAIProvider = React.useCallback((provider) => {
    setAiTesting(prev => ({ ...prev, [provider]: true }));
    
    const testOptions = {
      messages: [{ role: 'user', content: 'Hello, this is a test message.' }],
      texts: ['Test embedding text']
    };
    
    Meteor.call('ai.testProvider', provider, testOptions, (err, result) => {
      setAiTesting(prev => ({ ...prev, [provider]: false }));
      
      if (err) {
        console.error(`[testAIProvider] ${provider} test failed:`, err);
        notify({ 
          message: `${provider} test failed: ${err.reason || err.message}`, 
          kind: 'error' 
        });
      } else {
        console.log(`[testAIProvider] ${provider} test successful:`, result);
        notify({ 
          message: `${provider} test successful`, 
          kind: 'success' 
        });
      }
    });
  }, []);

  // Centralized preferences generation
  const generateAIPreferences = React.useCallback(() => ({
    mode: aiMode,
    fallback: aiFallback,
    timeoutMs: aiTimeoutMs,
    maxTokens: aiMaxTokens,
    temperature: aiTemperature,
    local: {
      host: aiLocalHost,
      chatModel: aiLocalChatModel,
      embeddingModel: aiLocalEmbeddingModel
    },
    remote: {
      provider: aiRemoteProvider,
      chatModel: aiRemoteChatModel,
      embeddingModel: aiRemoteEmbeddingModel
    }
  }), [aiMode, aiFallback, aiTimeoutMs, aiMaxTokens, aiTemperature, aiLocalHost, aiLocalChatModel, aiLocalEmbeddingModel, aiRemoteProvider, aiRemoteChatModel, aiRemoteEmbeddingModel]);

  // Centralized save function with debounce
  const saveAIPreferences = React.useCallback((showNotification = true) => {
    const preferences = generateAIPreferences();
    
    Meteor.call('ai.updatePreferences', preferences, (err) => {
      if (err) {
        if (showNotification) {
          notify({ 
            message: `Failed to save AI preferences: ${err.reason || err.message}`, 
            kind: 'error' 
          });
        } else {
          console.error('Auto-save failed:', err);
        }
        return;
      }
      
      if (showNotification) {
        notify({ 
          message: 'AI preferences saved successfully', 
          kind: 'success' 
        });
      }
      
      // Refresh Qdrant health to show updated collection name
      Meteor.call('qdrant.health', (err2, res) => {
        if (!err2 && res) {
          setHealth(res);
        }
      });
    });
  }, [generateAIPreferences]);

  // Debounced auto-save
  const debouncedAutoSave = React.useMemo(
    () => {
      let timeoutId;
      return () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => saveAIPreferences(false), 500);
      };
    },
    [saveAIPreferences]
  );

  // Auto-save when AI mode changes (only on user interaction, not on load)
  React.useEffect(() => {
    // Only auto-save if this is a user-initiated change, not initial load
    if (aiMode && pref?.ai && aiMode !== pref.ai.mode) {
      debouncedAutoSave();
    }
  }, [aiMode, debouncedAutoSave]);

  // Auto-save when embedding model changes (only on user interaction, not on load)
  React.useEffect(() => {
    // Only auto-save if this is a user-initiated change, not initial load
    if (aiLocalEmbeddingModel && pref?.ai?.local && aiLocalEmbeddingModel !== pref.ai.local.embeddingModel) {
      debouncedAutoSave();
    }
  }, [aiLocalEmbeddingModel, debouncedAutoSave]);

  // Auto-save when timeout changes
  React.useEffect(() => {
    if (aiTimeoutMs && pref?.ai && aiTimeoutMs !== pref.ai.timeoutMs) {
      debouncedAutoSave();
    }
  }, [aiTimeoutMs, debouncedAutoSave]);

  // Auto-save when max tokens changes
  React.useEffect(() => {
    if (aiMaxTokens && pref?.ai && aiMaxTokens !== pref.ai.maxTokens) {
      debouncedAutoSave();
    }
  }, [aiMaxTokens, debouncedAutoSave]);

  // Auto-save when temperature changes
  React.useEffect(() => {
    if (aiTemperature !== undefined && pref?.ai && aiTemperature !== pref.ai.temperature) {
      debouncedAutoSave();
    }
  }, [aiTemperature, debouncedAutoSave]);

  // Update Qdrant health when embedding model changes (for footer display)
  React.useEffect(() => {
    if (aiMode === 'local' || aiMode === 'auto') {
      Meteor.call('qdrant.health', (err, res) => {
        if (!err && res) {
          setHealth(res);
        }
      });
    }
  }, [aiLocalEmbeddingModel, aiMode]);

  // Token counting function
  const countTokens = React.useCallback(() => {
    setCountingTokens(true);
    setTokenStats(null);
    
    Meteor.call('panorama.countAllTokens', (err, result) => {
      setCountingTokens(false);
      
      if (err) {
        console.error('[countTokens] Failed to count tokens:', err);
        notify({
          message: `Failed to count tokens: ${err.reason || err.message}`,
          kind: 'error'
        });
      } else {
        setTokenStats(result);
        notify({
          message: `Token count completed: ${result.globalStats.totalTokens} tokens across ${result.globalStats.totalItems} items`,
          kind: 'success'
        });
      }
    });
  }, []);

  React.useEffect(() => {
    if (!pref) return;
    setFilesDir(pref.filesDir || '');
    setDevUrlMode(!!pref.devUrlMode);
    setOpenaiApiKey(pref.openaiApiKey || '');
    setPerplexityApiKey(pref.perplexityApiKey || '');
    setPennyBaseUrl(pref.pennylaneBaseUrl || '');
    setPennyToken(pref.pennylaneToken || '');
    setQdrantUrl(pref.qdrantUrl || '');
    setCalendarIcsUrl(pref.calendarIcsUrl || '');
  }, [pref?._id]);
  if (sub()) return <div>Loading…</div>;
  return (
    <div className="prefs">
      <h2>Preferences</h2>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Files directory</div>
          <div className="prefsValue">
            <InlineEditable
              value={filesDir}
              placeholder="/path/to/filesDir"
              fullWidth
              onSubmit={(next) => {
                setFilesDir(next);
                Meteor.call('appPreferences.update', { filesDir: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Qdrant URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={qdrantUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setQdrantUrl(next);
                Meteor.call('appPreferences.update', { qdrantUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Mobile tasks page (LAN)</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={mobileTasksEnabled ? 'enabled' : 'disabled'}
              options={[{ value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]}
              onSubmit={(next) => {
                const v = next === 'enabled';
                setMobileTasksEnabled(v);
                try {
                  window.localStorage.setItem('panorama.mobileTasksEnabled', String(v));
                } catch (e) {
                  console.warn('[prefs] localStorage write failed for panorama.mobileTasksEnabled', e);
                }
                Meteor.call('mobileTasksRoute.setEnabled', v, () => {});
                notify({ message: `Mobile tasks page ${v ? 'enabled' : 'disabled'}`, kind: 'success' });
              }}
            />
            {lanIp ? <span className="ml8" style={{ color: 'var(--muted)' }}>{`http://${lanIp}:3000`}</span> : null}
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Use Dev URL instead of bundled server</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={devUrlMode ? 'yes' : 'no'}
              options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
              onSubmit={(next) => {
                const v = next === 'yes';
                setDevUrlMode(v);
                Meteor.call('appPreferences.update', { devUrlMode: v }, () => {});
              }}
            />
          </div>
        </div>
      </div>

      <h3>Secrets</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">OpenAI API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={openaiApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setOpenaiApiKey(next);
                Meteor.call('appPreferences.update', { openaiApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Perplexity API Key</div>
          <div className="prefsValue">
            <InlineEditable
              value={perplexityApiKey}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPerplexityApiKey(next);
                Meteor.call('appPreferences.update', { perplexityApiKey: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Google Calendar</div>
          <div className="prefsValue">
            <div>
              <input
                className="afInput"
                type="text"
                placeholder="Paste your private ICS URL"
                value={calendarIcsUrl}
                onChange={(e) => setCalendarIcsUrl(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div className="mt8">
              <button
                className="btn"
                onClick={() => {
                  const url = String(calendarIcsUrl || '').trim();
                  if (!url) { notify({ message: 'ICS URL missing', kind: 'error' }); return; }
                  Meteor.call('calendar.setIcsUrl', url, (err) => {
                    if (err) { notify({ message: err?.reason || err?.message || 'Save failed', kind: 'error' }); return; }
                    notify({ message: 'ICS URL saved', kind: 'success' });
                  });
                }}
              >Link with GCal</button>
              <a className="btn-link ml8" href="#/calendar" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'calendar' }); }}>Open Calendar</a>
            </div>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Base URL</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyBaseUrl}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyBaseUrl(next);
                Meteor.call('appPreferences.update', { pennylaneBaseUrl: next }, () => {});
              }}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Pennylane Token</div>
          <div className="prefsValue">
            <InlineEditable
              value={pennyToken}
              placeholder="(not set)"
              fullWidth
              onSubmit={(next) => {
                setPennyToken(next);
                Meteor.call('appPreferences.update', { pennylaneToken: next }, () => {});
              }}
            />
          </div>
        </div>
      </div>

      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Display</div>
          <div className="prefsValue">
            <button
              className="btn"
              onClick={() => {
                if (window.electron?.resetZoom) {
                  window.electron.resetZoom();
                  notify({ message: 'Zoom reset to 100%', kind: 'success' });
                } else {
                  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '');
                  const msg = isElectron
                    ? 'Zoom reset not available yet. Please restart the app to enable it.'
                    : 'Zoom reset not available in browser';
                  notify({ message: msg, kind: 'error' });
                }
              }}
            >
              Reset zoom (100%)
            </button>
          </div>
        </div>
      </div>

      <h3>AI Backend</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Mode</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={aiMode}
              options={[
                { value: 'local', label: 'Local (Ollama)' },
                { value: 'remote', label: 'Remote (OpenAI)' },
                { value: 'auto', label: 'Auto (Local with Remote fallback)' }
              ]}
              onSubmit={(next) => setAiMode(next)}
            />
          </div>
        </div>
        
        {aiMode === 'auto' && (
          <div className="prefsRow">
            <div className="prefsLabel">Fallback</div>
            <div className="prefsValue">
              <InlineEditable
                as="select"
                value={aiFallback}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'local', label: 'Local' },
                  { value: 'remote', label: 'Remote' }
                ]}
                onSubmit={(next) => setAiFallback(next)}
              />
            </div>
          </div>
        )}

        <div className="prefsRow">
          <div className="prefsLabel">Timeout (ms)</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiTimeoutMs.toString()}
              onSubmit={(next) => setAiTimeoutMs(parseInt(next) || 30000)}
            />
          </div>
        </div>

        <div className="prefsRow">
          <div className="prefsLabel">Max Tokens</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiMaxTokens.toString()}
              onSubmit={(next) => setAiMaxTokens(parseInt(next) || 4000)}
            />
          </div>
        </div>

        <div className="prefsRow">
          <div className="prefsLabel">Temperature</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiTemperature.toString()}
              onSubmit={(next) => setAiTemperature(parseFloat(next) || 0.7)}
            />
          </div>
        </div>


        <div className="prefsRow">
          <div className="prefsLabel">Health Status</div>
          <div className="prefsValue">
            <button
              className="btn"
              onClick={checkAIHealth}
              style={{ marginRight: '8px' }}
            >
              Check Health
            </button>
            {aiHealthStatus ? (
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <span style={{ color: aiHealthStatus.local?.ok ? 'var(--success)' : 'var(--error)' }}>
                  Local: {aiHealthStatus.local?.ok ? '✓' : '✗'}
                </span>
                <span style={{ color: aiHealthStatus.remote?.ok ? 'var(--success)' : 'var(--error)' }}>
                  Remote: {aiHealthStatus.remote?.ok ? '✓' : '✗'}
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
            <button
              className="btn"
              onClick={() => testAIProvider('ollama')}
              disabled={aiTesting.ollama}
              style={{ marginRight: '8px' }}
            >
              {aiTesting.ollama ? 'Testing...' : 'Test Local'}
            </button>
            <button
              className="btn"
              onClick={() => testAIProvider('openai')}
              disabled={aiTesting.openai}
            >
              {aiTesting.openai ? 'Testing...' : 'Test Remote'}
            </button>
          </div>
        </div>
      </div>

      <h3>Local AI (Ollama)</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Host</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiLocalHost}
              fullWidth
              onSubmit={(next) => setAiLocalHost(next)}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Chat Model</div>
          <div className="prefsValue" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
            <button
              className="btn"
              onClick={loadOllamaModels}
              disabled={loadingModels}
              style={{ padding: '4px 8px', fontSize: '12px' }}
            >
              {loadingModels ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Embedding Model</div>
          <div className="prefsValue" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
        </div>
      </div>

      <h3>Remote AI (OpenAI)</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Provider</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={aiRemoteProvider}
              options={[
                { value: 'openai', label: 'OpenAI' }
              ]}
              onSubmit={(next) => setAiRemoteProvider(next)}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">API Key</div>
          <div className="prefsValue">
            <span style={{ color: 'var(--muted)' }}>
              Configurez la clé OpenAI dans la section « Secrets » ci‑dessus.
            </span>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Chat Model</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiRemoteChatModel}
              fullWidth
              onSubmit={(next) => setAiRemoteChatModel(next)}
            />
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Embedding Model</div>
          <div className="prefsValue">
            <InlineEditable
              value={aiRemoteEmbeddingModel}
              fullWidth
              onSubmit={(next) => setAiRemoteEmbeddingModel(next)}
            />
          </div>
        </div>
      </div>

      <h3>Test notify</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Notifications</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              playBeep(0.5);
              notify({ message: 'Test beep played', kind: 'success' });
            }}>Test audio</button>
            <button className="btn ml8" onClick={() => {
              setTimeout(() => {
                playBeep(0.5);
                notify({ message: 'Delayed test: beep + notify', kind: 'success' });
              }, 3000);
            }}>Test delayed audio (3s)</button>
            <button className="btn ml8" onClick={() => {
              const tests = [
                { message: 'Info notify test', kind: 'info' },
                { message: 'Success notify test', kind: 'success' },
                { message: 'Error notify test', kind: 'error' }
              ];
              tests.forEach((t, i) => setTimeout(() => notify(t), i * 1200));
            }}>Test all notify</button>
          </div>
        </div>
      </div>

      <h3>Test errors</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Client and Server</div>
          <div className="prefsValue">
            <button className="btn" onClick={() => {
              setTimeout(() => { throw new Error('Test client error'); }, 0);
            }}>Throw error</button>
            <button className="btn ml8" onClick={() => {
              Promise.reject(new Error('Test unhandled rejection'));
            }}>Unhandled rejection</button>
            <button className="btn ml8" onClick={() => {
              Meteor.call('nonexistent.method');
            }}>Fail method</button>
          </div>
        </div>
      </div>

      <h3>Email CTA Suggestions</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Enable CTA Suggestions</div>
          <div className="prefsValue">
            <InlineEditable
              as="select"
              value={ctaEnabled ? 'true' : 'false'}
              options={[
                { value: 'true', label: 'Enabled' },
                { value: 'false', label: 'Disabled' }
              ]}
              onSubmit={(next) => {
                const enabled = next === 'true';
                setCtaEnabled(enabled);
                Meteor.call('appPreferences.update', { cta: { enabled } }, () => {});
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
                  Meteor.call('appPreferences.update', { cta: { model: next } }, () => {});
                }}
              />
            </div>
          </div>
        )}
      </div>

      <h3>Token Statistics</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Count Tokens</div>
          <div className="prefsValue">
            <button 
              className="btn" 
              disabled={countingTokens} 
              onClick={countTokens}
            >
              {countingTokens ? 'Counting…' : 'Count All Tokens'}
            </button>
            <span style={{ marginLeft: '8px', color: 'var(--muted)', fontSize: '14px' }}>
              Analyze text content from all collections
            </span>
          </div>
        </div>
        
        {tokenStats && (
          <>
            <div className="prefsRow">
              <div className="prefsLabel">Global Summary</div>
              <div className="prefsValue">
                <div style={{ 
                  background: 'var(--bg-secondary)', 
                  padding: '12px', 
                  borderRadius: '6px',
                  fontSize: '14px',
                  lineHeight: '1.5'
                }}>
                  <div><strong>Total:</strong> {tokenStats.globalStats.totalTokens.toLocaleString()} tokens</div>
                  <div><strong>Items:</strong> {tokenStats.globalStats.totalItems.toLocaleString()} items</div>
                  <div><strong>Characters:</strong> {tokenStats.globalStats.totalCharacters.toLocaleString()}</div>
                  <div><strong>Average:</strong> {tokenStats.globalStats.avgTokensPerItem} tokens/item</div>
                  <div><strong>Ratio:</strong> {tokenStats.globalStats.tokensPerChar} tokens/character</div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Generated on {new Date(tokenStats.generatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="prefsRow">
              <div className="prefsLabel">Collection Details</div>
              <div className="prefsValue">
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {Object.entries(tokenStats.collections).map(([collectionName, stats]) => (
                    <div key={collectionName} style={{ 
                      marginBottom: '12px', 
                      padding: '8px 12px', 
                      background: 'var(--bg-secondary)', 
                      borderRadius: '4px',
                      fontSize: '13px'
                    }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {collectionName}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        {stats.description}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', fontSize: '12px' }}>
                        <div><strong>Items:</strong> {stats.totalItems}</div>
                        <div><strong>With content:</strong> {stats.itemsWithContent}</div>
                        <div><strong>Tokens:</strong> {stats.tokens.toLocaleString()}</div>
                        <div><strong>Characters:</strong> {stats.characters.toLocaleString()}</div>
                        <div><strong>Average:</strong> {stats.avgTokensPerItem}</div>
                      </div>
                      {stats.error && (
                        <div style={{ color: 'var(--error)', marginTop: '4px', fontSize: '11px' }}>
                          Error: {stats.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <h3>Qdrant</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Health</div>
          <div className="prefsValue">
            <button className="btn" disabled={checking} onClick={() => {
              setChecking(true);
              Meteor.call('qdrant.health', (err, res) => { setChecking(false); setHealth(err ? { error: err?.reason || err?.message || String(err) } : res); });
            }}>{checking ? 'Checking…' : 'Check health'}</button>
            <button className="btn ml8" disabled={indexing} onClick={() => setConfirmIndex(true)}>{indexing ? 'Indexing…' : 'Rebuild index'}</button>
          </div>
        </div>

        {health?.collection && (
          <div className="prefsRow">
            <div className="prefsLabel">Active Collection</div>
            <div className="prefsValue">
              <code style={{ 
                background: 'var(--bg-secondary)', 
                padding: '4px 8px', 
                borderRadius: '4px',
                fontSize: '14px',
                color: 'var(--text-primary)'
              }}>
                {health.collection}
              </code>
              <span style={{ marginLeft: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                {aiMode === 'remote' ? 'Base collection (no model suffix)' : 'Model-specific collection'}
              </span>
              {health.incompatible && (
                <div style={{ 
                  marginTop: '8px', 
                  padding: '8px 12px', 
                  background: 'var(--warning-bg)', 
                  border: '1px solid var(--warning-border)', 
                  borderRadius: '4px',
                  fontSize: '13px',
                  color: 'var(--warning-text)'
                }}>
                  ⚠️ Collection incompatible with current model. Expected {health.expectedVectorSize} dimensions, but collection has {health.vectorSize} dimensions.
                  <br />
                  <button 
                    className="btn" 
                    style={{ marginTop: '4px', fontSize: '12px', padding: '2px 8px' }}
                    onClick={() => setConfirmIndex(true)}
                  >
                    Recreate Collection
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="prefsRow">
          <div className="prefsLabel">Debug last indexed</div>
          <div className="prefsValue">
            <button
              className="btn"
              disabled={fetchingLines}
              onClick={() => {
                setFetchingLines(true);
                Meteor.call('qdrant.lastIndexedRaw', (err, res) => {
                  setFetchingLines(false);
                  setRawLines(err ? { error: err?.reason || err?.message || String(err) } : res);
                });
              }}
            >
              {fetchingLines ? 'Fetching…' : 'Fetch last indexed (raw)'}
            </button>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">Rebuild by kind</div>
          <div className="prefsValue">
            <select
              className="afInput"
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
            >
              <option value="project">Projects</option>
              <option value="task">Tasks</option>
              <option value="note">Notes</option>
              <option value="session">Sessions</option>
              <option value="line">Note lines</option>
              <option value="alarm">Alarms</option>
              <option value="link">Links</option>
              <option value="userlog">Logs</option>
              <option value="email">Emails</option>
            </select>
            <button
              className="btn ml8"
              disabled={indexing}
              onClick={() => {
                const kind = selectedKind;
                setIndexing(true);
                Meteor.call('qdrant.indexKindStart', kind, (err, res) => {
                  if (err || !res) {
                    setIndexing(false);
                    notify({ message: `Rebuild failed for ${kind}: ${err?.reason || err?.message || 'unknown error'}` , kind: 'error' });
                    return;
                  }
                  setIndexJob({ jobId: res.jobId, total: res.total, processed: 0, upserts: 0, errors: 0, done: false });
                  pollIndexStatus(res.jobId);
                });
              }}
            >
              {indexing ? 'Indexing…' : 'Rebuild selected'}
            </button>
          </div>
        </div>
        {indexJob ? (
          <div className="prefsRow">
            <div className="prefsLabel">Index progress</div>
            <div className="prefsValue">
              <div className="progressBar" aria-label="Indexing progress">
                <div className="progressBarFill" style={{ width: `${Math.min(100, Math.round(((indexJob.processed || 0) / Math.max(1, indexJob.total || 0)) * 100))}%` }} />
              </div>
              <div className="progressText">
                {`${indexJob.processed || 0}/${indexJob.total || 0} chunks processed · ${indexJob.upserts || 0} upserts · ${indexJob.errors || 0} errors`}
              </div>
            </div>
          </div>
        ) : null}
        {health ? (
          <div className="prefsRow">
            <div className="prefsLabel" />
            <div className="prefsValue"><pre className="prefsPre">{JSON.stringify(health, null, 2)}</pre></div>
          </div>
        ) : null}
        {rawLines ? (
          <div className="prefsRow">
            <div className="prefsLabel" />
            <div className="prefsValue"><pre className="prefsPre">{JSON.stringify(rawLines, null, 2)}</pre></div>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmIndex}
        onClose={() => setConfirmIndex(false)}
        title="Rebuild Qdrant index?"
        actions={[
          <button key="cancel" className="btn" onClick={() => setConfirmIndex(false)}>Cancel</button>,
          <button key="ok" className="btn" onClick={() => { setConfirmIndex(false); startRebuild(); }}>Rebuild</button>
        ]}
      >
        <p>This will drop and recreate the collection, then reindex all documents.</p>
        <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
          <strong>Collection:</strong> <code style={{ 
            background: 'var(--bg-secondary)', 
            padding: '2px 6px', 
            borderRadius: '3px',
            fontSize: '13px'
          }}>
            {aiMode === 'remote' ? 'panorama' : `panorama_${aiLocalEmbeddingModel.replace(/[^a-zA-Z0-9]/g, '_')}`}
          </code>
          <span style={{ marginLeft: '8px', fontSize: '12px' }}>
            ({aiMode === 'remote' ? 'Base collection' : 'Model-specific collection'})
          </span>
        </p>
      </Modal>
      
      <div className="prefsFooter">
        <a href="#/onboarding" className="btn-link" onClick={(e) => { e.preventDefault(); navigateTo({ name: 'onboarding' }); }}>Open Onboarding</a>
      </div>
    </div>
  );
}


