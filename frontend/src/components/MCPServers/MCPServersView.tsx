import { useState, useEffect } from 'react';
import type { MCPServer } from '../../types';
import { mcpServersApi } from '../../services/api';
import './MCPServersView.css';

export function MCPServersView() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('http');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await mcpServersApi.list();
      setServers(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName(''); setType('http'); setCommand(''); setArgs(''); setEnv(''); setUrl(''); setHeaders('');
    setEditingId(null); setShowForm(false);
  }

  function editServer(s: MCPServer) {
    setEditingId(s._id);
    setName(s.name);
    setType(s.type);
    setCommand(s.command || '');
    setArgs((s.args || []).join(', '));
    setEnv(s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '');
    setUrl(s.url || '');
    setHeaders(s.headers ? Object.entries(s.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '');
    setShowForm(true);
  }

  function parseKeyValue(text: string, separator: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n').filter(l => l.trim())) {
      const idx = line.indexOf(separator);
      if (idx > 0) {
        result[line.slice(0, idx).trim()] = line.slice(idx + separator.length).trim();
      }
    }
    return result;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: any = { name, type, enabled: true };

    if (type === 'stdio') {
      data.command = command;
      data.args = args.split(',').map(a => a.trim()).filter(Boolean);
      if (env.trim()) data.env = parseKeyValue(env, '=');
    } else {
      data.url = url;
      if (headers.trim()) data.headers = parseKeyValue(headers, ':');
    }

    try {
      if (editingId) {
        await mcpServersApi.update(editingId, data);
      } else {
        await mcpServersApi.create(data);
      }
      resetForm();
      load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce serveur MCP ?')) return;
    await mcpServersApi.delete(id);
    load();
  }

  async function handleToggle(s: MCPServer) {
    await mcpServersApi.update(s._id, { enabled: !s.enabled });
    load();
  }

  async function handleTest(id: string) {
    setTestResult(prev => ({ ...prev, [id]: 'testing...' }));
    try {
      const result = await mcpServersApi.test(id);
      setTestResult(prev => ({ ...prev, [id]: result.ok ? 'OK' : JSON.stringify(result) }));
    } catch (err: any) {
      setTestResult(prev => ({ ...prev, [id]: `Erreur: ${err.message}` }));
    }
  }

  if (loading) return <div className="mcp-loading">Chargement...</div>;

  return (
    <div className="mcp-container">
      <div className="mcp-header">
        <h2>Serveurs MCP</h2>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Ajouter
        </button>
      </div>

      {showForm && (
        <form className="mcp-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Nom</label>
            <input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Type</label>
            <select value={type} onChange={e => setType(e.target.value as any)}>
              <option value="http">HTTP (distant)</option>
              <option value="stdio">Stdio (local)</option>
            </select>
          </div>

          {type === 'http' ? (
            <>
              <div className="form-row">
                <label>URL</label>
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." required />
              </div>
              <div className="form-row">
                <label>Headers (un par ligne, Key: Value)</label>
                <textarea value={headers} onChange={e => setHeaders(e.target.value)} rows={3} placeholder="X-API-Key: secret" />
              </div>
            </>
          ) : (
            <>
              <div className="form-row">
                <label>Commande</label>
                <input value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" required />
              </div>
              <div className="form-row">
                <label>Arguments (séparés par virgule)</label>
                <input value={args} onChange={e => setArgs(e.target.value)} placeholder="@modelcontextprotocol/server-notion" />
              </div>
              <div className="form-row">
                <label>Env (un par ligne, KEY=VALUE)</label>
                <textarea value={env} onChange={e => setEnv(e.target.value)} rows={3} placeholder="NOTION_API_KEY=secret" />
              </div>
            </>
          )}

          <div className="form-actions">
            <button type="submit" className="btn-primary">{editingId ? 'Modifier' : 'Créer'}</button>
            <button type="button" className="btn-secondary" onClick={resetForm}>Annuler</button>
          </div>
        </form>
      )}

      {servers.length === 0 && !showForm && (
        <p className="empty">Aucun serveur MCP configuré.</p>
      )}

      <div className="mcp-list">
        {servers.map(s => (
          <div key={s._id} className={`mcp-card ${s.enabled ? '' : 'disabled'}`}>
            <div className="mcp-card-header">
              <div className="mcp-card-title">
                <span className={`mcp-type-badge ${s.type}`}>{s.type.toUpperCase()}</span>
                <strong>{s.name}</strong>
              </div>
              <div className="mcp-card-actions">
                <button className="btn-icon" onClick={() => handleToggle(s)} title={s.enabled ? 'Désactiver' : 'Activer'}>
                  {s.enabled ? 'ON' : 'OFF'}
                </button>
                <button className="btn-icon" onClick={() => handleTest(s._id)} title="Tester">Test</button>
                <button className="btn-icon" onClick={() => editServer(s)} title="Modifier">Edit</button>
                <button className="btn-icon danger" onClick={() => handleDelete(s._id)} title="Supprimer">X</button>
              </div>
            </div>
            <div className="mcp-card-details">
              {s.type === 'http' && <span className="mcp-detail">{s.url}</span>}
              {s.type === 'stdio' && <span className="mcp-detail">{s.command} {(s.args || []).join(' ')}</span>}
              {s.lastConnectedAt && <span className="mcp-detail mcp-connected">Dernière connexion: {new Date(s.lastConnectedAt).toLocaleString('fr')}</span>}
              {s.lastError && <span className="mcp-detail mcp-error">Erreur: {s.lastError}</span>}
            </div>
            {testResult[s._id] && (
              <div className={`mcp-test-result ${testResult[s._id].startsWith('Erreur') ? 'error' : 'success'}`}>
                {testResult[s._id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
