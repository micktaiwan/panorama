import { useState, useEffect, useCallback } from 'react';
import { situations as api } from '../../services/api';
import type { Situation, SituationActor, SituationNote, SituationSummary } from '../../types';
import './SituationsView.css';

export function SituationsView() {
  const [items, setItems] = useState<Situation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ situation: Situation; actors: SituationActor[]; notes: SituationNote[]; summaries: SituationSummary[] } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [noteForm, setNoteForm] = useState('');
  const [actorForm, setActorForm] = useState({ name: '', role: '', situationRole: '' });

  const loadList = useCallback(async () => {
    const res = await api.list();
    setItems(res.situations);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await api.get(id);
    setDetail(res);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected, loadDetail]);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    const res = await api.create(form);
    setForm({ title: '', description: '' });
    setIsCreating(false);
    loadList();
    setSelected(res.situation._id);
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    if (selected === id) { setSelected(null); setDetail(null); }
    loadList();
  };

  const handleAddActor = async () => {
    if (!selected || !actorForm.name.trim()) return;
    await api.addActor(selected, actorForm);
    setActorForm({ name: '', role: '', situationRole: '' });
    loadDetail(selected);
  };

  const handleRemoveActor = async (actorId: string) => {
    if (!selected) return;
    await api.removeActor(selected, actorId);
    loadDetail(selected);
  };

  const handleAddNote = async () => {
    if (!selected || !noteForm.trim()) return;
    await api.addNote(selected, { content: noteForm });
    setNoteForm('');
    loadDetail(selected);
  };

  const handleAddSummary = async () => {
    if (!selected) return;
    const text = prompt('Texte du résumé :');
    if (!text?.trim()) return;
    await api.addSummary(selected, text);
    loadDetail(selected);
  };

  return (
    <div className="situations-container">
      <div className="situations-sidebar">
        <div className="sidebar-header">
          <h3>Situations</h3>
          <button className="btn-small btn-primary" onClick={() => setIsCreating(true)}>+</button>
        </div>

        {isCreating && (
          <div className="sit-form">
            <input placeholder="Titre *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            <div className="form-actions">
              <button className="btn-small btn-primary" onClick={handleCreate}>Créer</button>
              <button className="btn-small" onClick={() => setIsCreating(false)}>Annuler</button>
            </div>
          </div>
        )}

        <div className="sit-list">
          {items.map(s => (
            <div
              key={s._id}
              className={`sit-item ${selected === s._id ? 'active' : ''}`}
              onClick={() => setSelected(s._id)}
            >
              <span className="sit-title">{s.title}</span>
              <button className="btn-tiny btn-danger" onClick={e => { e.stopPropagation(); handleDelete(s._id); }}>X</button>
            </div>
          ))}
          {items.length === 0 && !isCreating && <p className="empty">Aucune situation</p>}
        </div>
      </div>

      <div className="situations-detail">
        {detail ? (
          <>
            <h2>{detail.situation.title}</h2>
            {detail.situation.description && <p className="sit-desc">{detail.situation.description}</p>}

            <section className="detail-section">
              <h3>Acteurs ({detail.actors.length})</h3>
              <div className="actors-list">
                {detail.actors.map(a => (
                  <div key={a._id} className="actor-chip">
                    <strong>{a.name}</strong>
                    {a.situationRole && <span className="actor-role">{a.situationRole}</span>}
                    <button className="btn-tiny btn-danger" onClick={() => handleRemoveActor(a._id)}>X</button>
                  </div>
                ))}
              </div>
              <div className="add-actor-form">
                <input placeholder="Nom *" value={actorForm.name} onChange={e => setActorForm(f => ({ ...f, name: e.target.value }))} />
                <input placeholder="Rôle situation" value={actorForm.situationRole} onChange={e => setActorForm(f => ({ ...f, situationRole: e.target.value }))} />
                <button className="btn-small btn-primary" onClick={handleAddActor}>Ajouter</button>
              </div>
            </section>

            <section className="detail-section">
              <h3>Notes ({detail.notes.length})</h3>
              <div className="notes-list">
                {detail.notes.map(n => (
                  <div key={n._id} className="note-item">
                    <p>{n.content}</p>
                    <span className="note-date">{new Date(n.createdAt).toLocaleString('fr-FR')}</span>
                  </div>
                ))}
              </div>
              <div className="add-note-form">
                <textarea placeholder="Ajouter une note..." value={noteForm} onChange={e => setNoteForm(e.target.value)} rows={2} />
                <button className="btn-small btn-primary" onClick={handleAddNote}>Ajouter</button>
              </div>
            </section>

            <section className="detail-section">
              <div className="section-header">
                <h3>Résumés ({detail.summaries.length})</h3>
                <button className="btn-small" onClick={handleAddSummary}>+ Résumé</button>
              </div>
              {detail.summaries.map(s => (
                <div key={s._id} className="summary-item">
                  <p>{s.text}</p>
                  <span className="note-date">{new Date(s.createdAt).toLocaleString('fr-FR')}</span>
                </div>
              ))}
            </section>
          </>
        ) : (
          <p className="empty">Sélectionnez une situation</p>
        )}
      </div>
    </div>
  );
}
