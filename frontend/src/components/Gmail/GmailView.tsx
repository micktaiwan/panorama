import { useState, useEffect } from 'react';
import type { GmailMessage, GmailStats, GmailStatus } from '../../types';
import { gmailApi } from '../../services/api';
import './GmailView.css';

export function GmailView() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [stats, setStats] = useState<GmailStats | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<GmailMessage[]>([]);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadMessages(); }, [showArchived]);

  async function loadAll() {
    try {
      const [s, st] = await Promise.all([gmailApi.status(), gmailApi.stats()]);
      setStatus(s);
      setStats(st);
      await loadMessages();
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages() {
    try {
      const data = await gmailApi.listMessages({ archived: showArchived, limit: 100 });
      setMessages(data.messages);
      setTotal(data.total);
    } catch (err: any) {
      console.error(err);
    }
  }

  async function handleConnect() {
    try {
      const { url } = await gmailApi.getAuthUrl();
      window.open(url, '_blank');
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Déconnecter Gmail ?')) return;
    await gmailApi.disconnect();
    loadAll();
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await gmailApi.sync({ maxResults: 50 });
      alert(`Sync terminée: ${result.imported} nouveaux sur ${result.total}`);
      loadAll();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleArchive(messageId: string) {
    await gmailApi.archive(messageId);
    setMessages(prev => prev.filter(m => m.messageId !== messageId));
    if (stats) setStats({ ...stats, inbox: stats.inbox - 1, archived: stats.archived + 1 });
  }

  async function handleTrash(messageId: string) {
    if (!confirm('Supprimer ce message ?')) return;
    await gmailApi.trash(messageId);
    setMessages(prev => prev.filter(m => m.messageId !== messageId));
    if (stats) setStats({ ...stats, total: stats.total - 1 });
  }

  async function openThread(threadId: string) {
    setSelectedThread(threadId);
    try {
      const msgs = await gmailApi.getThread(threadId);
      setThreadMessages(msgs);
    } catch (err: any) {
      console.error(err);
    }
  }

  if (loading) return <div className="gmail-loading">Chargement...</div>;

  return (
    <div className="gmail-container">
      <div className="gmail-header">
        <h2>Gmail</h2>
        <div className="gmail-header-actions">
          {status?.connected ? (
            <>
              <button className="btn-primary" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Sync...' : 'Synchroniser'}
              </button>
              <button className="btn-secondary" onClick={handleDisconnect}>Déconnecter</button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={handleConnect}
              disabled={!status?.oauthConfigured}
              title={status?.oauthConfigured ? '' : 'Configurez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans le backend'}
            >
              Connecter Gmail
            </button>
          )}
        </div>
      </div>

      {!status?.oauthConfigured && (
        <div className="gmail-notice">
          OAuth Google non configuré. Ajoutez <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code> dans les variables d'environnement du backend.
        </div>
      )}

      {stats && (
        <div className="gmail-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.inbox}</span>
            <span className="stat-label">Inbox</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.unread}</span>
            <span className="stat-label">Non lus</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.archived}</span>
            <span className="stat-label">Archivés</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.total}</span>
            <span className="stat-label">Total</span>
          </div>
        </div>
      )}

      <div className="gmail-toolbar">
        <button
          className={`tab-btn ${!showArchived ? 'active' : ''}`}
          onClick={() => setShowArchived(false)}
        >
          Inbox ({stats?.inbox || 0})
        </button>
        <button
          className={`tab-btn ${showArchived ? 'active' : ''}`}
          onClick={() => setShowArchived(true)}
        >
          Archives ({stats?.archived || 0})
        </button>
      </div>

      {selectedThread ? (
        <div className="gmail-thread">
          <button className="btn-secondary" onClick={() => setSelectedThread(null)}>
            Retour
          </button>
          <div className="thread-messages">
            {threadMessages.map(m => (
              <div key={m._id} className="thread-message">
                <div className="thread-msg-header">
                  <strong>{m.from}</strong>
                  <span>{new Date(m.gmailDate).toLocaleString('fr')}</span>
                </div>
                <div className="thread-msg-subject">{m.subject}</div>
                {m.snippet && <p className="thread-msg-snippet">{m.snippet}</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="gmail-messages">
          {messages.length === 0 ? (
            <p className="empty">
              {status?.connected ? 'Aucun message. Lancez une synchronisation.' : 'Connectez votre compte Gmail.'}
            </p>
          ) : (
            messages.map(m => (
              <div key={m._id} className={`gmail-row ${m.isRead ? '' : 'unread'}`}>
                <div className="gmail-row-main" onClick={() => openThread(m.threadId)}>
                  <span className="gmail-from">{m.from.split('<')[0].trim()}</span>
                  <span className="gmail-subject">{m.subject || '(sans objet)'}</span>
                  <span className="gmail-snippet">{m.snippet}</span>
                </div>
                <div className="gmail-row-meta">
                  <span className="gmail-date">{new Date(m.gmailDate).toLocaleDateString('fr')}</span>
                  <div className="gmail-row-actions">
                    {!showArchived && (
                      <button className="btn-icon" onClick={() => handleArchive(m.messageId)} title="Archiver">A</button>
                    )}
                    <button className="btn-icon danger" onClick={() => handleTrash(m.messageId)} title="Supprimer">X</button>
                  </div>
                </div>
              </div>
            ))
          )}
          {total > messages.length && (
            <p className="gmail-more">{total - messages.length} messages de plus...</p>
          )}
        </div>
      )}
    </div>
  );
}
