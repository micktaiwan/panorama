import { useState, useEffect } from 'react';
import type { NotionIntegration, NotionTicket } from '../../types';
import { notionApi } from '../../services/api';
import './NotionView.css';

export function NotionView() {
  const [integrations, setIntegrations] = useState<NotionIntegration[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<NotionTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formDbId, setFormDbId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLifecycle, setFormLifecycle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { loadIntegrations(); }, []);

  useEffect(() => {
    if (selectedId) loadTickets(selectedId);
    else setTickets([]);
  }, [selectedId]);

  async function loadIntegrations() {
    try {
      const data = await notionApi.listIntegrations();
      setIntegrations(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0]._id);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadTickets(integrationId: string) {
    try {
      const data = await notionApi.getTickets(integrationId);
      setTickets(data);
    } catch (err: any) {
      console.error(err);
    }
  }

  function resetForm() {
    setFormName(''); setFormDbId(''); setFormDescription(''); setFormLifecycle('');
    setEditingId(null); setShowForm(false);
  }

  function editIntegration(i: NotionIntegration) {
    setEditingId(i._id);
    setFormName(i.name);
    setFormDbId(i.databaseId);
    setFormDescription(i.description || '');
    setFormLifecycle((i.filters?.lifecycle || []).join(', '));
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: any = {
      name: formName,
      databaseId: formDbId,
      description: formDescription || undefined,
      filters: {
        lifecycle: formLifecycle.split(',').map(s => s.trim()).filter(Boolean),
      },
    };

    try {
      if (editingId) {
        await notionApi.updateIntegration(editingId, data);
      } else {
        await notionApi.createIntegration(data);
      }
      resetForm();
      loadIntegrations();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleSync(integrationId: string) {
    try {
      await notionApi.sync(integrationId);
      // Reload after a delay for background sync
      setTimeout(() => loadTickets(integrationId), 2000);
      setTimeout(() => { loadTickets(integrationId); loadIntegrations(); }, 5000);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette intégration et tous ses tickets ?')) return;
    await notionApi.deleteIntegration(id);
    if (selectedId === id) setSelectedId(null);
    loadIntegrations();
  }

  const selected = integrations.find(i => i._id === selectedId);

  if (loading) return <div className="notion-loading">Chargement...</div>;

  return (
    <div className="notion-container">
      <div className="notion-header">
        <h2>Notion</h2>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Intégration
        </button>
      </div>

      {showForm && (
        <form className="notion-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Nom</label>
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Stories Squad Data" required />
          </div>
          <div className="form-row">
            <label>Database ID Notion</label>
            <input value={formDbId} onChange={e => setFormDbId(e.target.value)} placeholder="abc123..." required />
          </div>
          <div className="form-row">
            <label>Description</label>
            <input value={formDescription} onChange={e => setFormDescription(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Filtres Lifecycle (virgule)</label>
            <input value={formLifecycle} onChange={e => setFormLifecycle(e.target.value)} placeholder="Ongoing, Delivering" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary">{editingId ? 'Modifier' : 'Créer'}</button>
            <button type="button" className="btn-secondary" onClick={resetForm}>Annuler</button>
          </div>
        </form>
      )}

      {integrations.length === 0 && !showForm ? (
        <p className="empty">Aucune intégration Notion configurée.</p>
      ) : (
        <div className="notion-layout">
          <div className="notion-sidebar">
            {integrations.map(i => (
              <div
                key={i._id}
                className={`notion-int-item ${selectedId === i._id ? 'active' : ''}`}
                onClick={() => setSelectedId(i._id)}
              >
                <strong>{i.name}</strong>
                {i.syncInProgress && <span className="notion-syncing">Sync...</span>}
                {i.lastSyncAt && <span className="notion-last-sync">{new Date(i.lastSyncAt).toLocaleDateString('fr')}</span>}
              </div>
            ))}
          </div>

          <div className="notion-main">
            {selected && (
              <>
                <div className="notion-detail-header">
                  <h3>{selected.name}</h3>
                  <div className="notion-detail-actions">
                    <button className="btn-primary" onClick={() => handleSync(selected._id)}>
                      Sync
                    </button>
                    <button className="btn-secondary" onClick={() => editIntegration(selected)}>Edit</button>
                    <button className="btn-danger" onClick={() => handleDelete(selected._id)}>Supprimer</button>
                  </div>
                </div>

                {selected.syncProgress && (
                  <div className="notion-sync-status">
                    {selected.syncProgress.status}: {selected.syncProgress.current} tickets ({selected.syncProgress.pageCount} pages)
                  </div>
                )}

                <div className="notion-tickets">
                  {tickets.length === 0 ? (
                    <p className="empty">Aucun ticket. Lancez une synchronisation.</p>
                  ) : (
                    <table className="notion-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Titre</th>
                          <th>Lifecycle</th>
                          <th>Priority</th>
                          <th>Owners</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map(t => (
                          <tr key={t._id}>
                            <td className="ticket-id">{t.ticketId || '-'}</td>
                            <td>
                              {t.url ? (
                                <a href={t.url} target="_blank" rel="noopener noreferrer">{t.title}</a>
                              ) : t.title}
                            </td>
                            <td>{t.lifecycle || '-'}</td>
                            <td>{t.priority || '-'}</td>
                            <td>{t.owners?.map(o => o.name).join(', ') || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
