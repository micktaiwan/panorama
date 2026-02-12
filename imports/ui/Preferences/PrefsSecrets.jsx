import React from 'react';
import { navigateTo } from '../router.js';

export const PrefsSecrets = () => {
  return (
    <>
      <h3>Secrets &amp; Integrations</h3>
      <div className="prefsSection">
        <div className="prefsRow">
          <div className="prefsLabel">Configuration</div>
          <div className="prefsValue">
            <p className="muted" style={{ margin: '0 0 8px 0', fontSize: '13px' }}>
              Les clés API et tokens (OpenAI, Anthropic, Perplexity, Pennylane, Slack, Google Calendar)
              sont configurés côté serveur via <code>settings.json</code> ou variables d'environnement.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '12px' }}>
              En local : <code>meteor --settings settings.json</code><br />
              En production : variables d'environnement dans la config MUP / Docker.
            </p>
          </div>
        </div>
        <div className="prefsRow">
          <div className="prefsLabel">MCP Servers</div>
          <div className="prefsValue">
            <div className="muted" style={{ marginBottom: '8px', fontSize: '13px' }}>
              Configure external MCP servers (Notion, Google Calendar, etc.)
            </div>
            <button
              className="btn"
              onClick={() => navigateTo({ name: 'mcpServers' })}
            >
              Manage MCP Servers
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
