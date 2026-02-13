import { useState, useEffect, useCallback } from 'react';
import { links as api } from '../../services/api';
import type { Link } from '../../types';
import './LinksList.css';

export function LinksList() {
  const [items, setItems] = useState<Link[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '' });

  const load = useCallback(async () => {
    const res = await api.list();
    setItems(res.links);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    await api.create(form);
    setForm({ name: '', url: '' });
    setIsCreating(false);
    load();
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name.trim()) return;
    await api.update(editingId, form);
    setEditingId(null);
    setForm({ name: '', url: '' });
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  const handleClick = async (link: Link) => {
    api.click(link._id);
    window.open(link.url, '_blank', 'noopener');
  };

  const startEdit = (link: Link) => {
    setEditingId(link._id);
    setForm({ name: link.name, url: link.url });
    setIsCreating(false);
  };

  return (
    <div className="links-container">
      <div className="links-toolbar">
        <h2>Liens</h2>
        <button className="btn-primary" onClick={() => { setIsCreating(true); setEditingId(null); setForm({ name: '', url: '' }); }}>+ Lien</button>
      </div>

      {(isCreating || editingId) && (
        <div className="links-form">
          <input placeholder="Nom *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input placeholder="URL *" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <div className="form-actions">
            {editingId
              ? <button className="btn-primary" onClick={handleUpdate}>Enregistrer</button>
              : <button className="btn-primary" onClick={handleCreate}>Créer</button>}
            <button className="btn-secondary" onClick={() => { setIsCreating(false); setEditingId(null); }}>Annuler</button>
          </div>
        </div>
      )}

      <div className="links-list">
        {items.map(link => (
          <div key={link._id} className="link-card">
            <div className="link-info" onClick={() => handleClick(link)}>
              <strong className="link-name">{link.name}</strong>
              <span className="link-url">{link.url}</span>
              {link.clicksCount > 0 && <span className="link-clicks">{link.clicksCount} clic{link.clicksCount > 1 ? 's' : ''}</span>}
            </div>
            <div className="link-actions">
              <button className="btn-small" onClick={() => startEdit(link)}>Modifier</button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(link._id)}>Supprimer</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="empty">Aucun lien</p>}
      </div>
    </div>
  );
}
