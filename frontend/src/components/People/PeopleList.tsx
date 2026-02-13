import { useState, useEffect, useCallback } from 'react';
import { people as api, teams as teamsApi } from '../../services/api';
import type { Person, Team } from '../../types';
import './PeopleList.css';

export function PeopleList() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [teamsList, setTeamsList] = useState<Team[]>([]);
  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ name: '', lastName: '', email: '', role: '', notes: '', teamId: '', left: false, contactOnly: false });

  const load = useCallback(async () => {
    const [pRes, tRes] = await Promise.all([
      api.list({ q: search || undefined, teamId: filterTeam || undefined, left: showLeft ? undefined : false }),
      teamsApi.list(),
    ]);
    setPersons(pRes.people);
    setTeamsList(tRes.teams);
  }, [search, filterTeam, showLeft]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: '', lastName: '', email: '', role: '', notes: '', teamId: '', left: false, contactOnly: false });
    setSelected(null);
    setIsEditing(false);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await api.create({ ...form, teamId: form.teamId || null });
    resetForm();
    load();
  };

  const handleUpdate = async () => {
    if (!selected || !form.name.trim()) return;
    await api.update(selected._id, { ...form, teamId: form.teamId || null });
    resetForm();
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    if (selected?._id === id) resetForm();
    load();
  };

  const startEdit = (p: Person) => {
    setSelected(p);
    setIsEditing(true);
    setForm({
      name: p.name, lastName: p.lastName, email: p.email, role: p.role,
      notes: p.notes, teamId: p.teamId || '', left: p.left, contactOnly: p.contactOnly,
    });
  };

  const teamName = (id: string | null) => teamsList.find(t => t._id === id)?.name || '';

  return (
    <div className="people-container">
      <div className="people-toolbar">
        <input
          className="people-search"
          placeholder="Rechercher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="">Toutes les équipes</option>
          {teamsList.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
        <label className="people-toggle">
          <input type="checkbox" checked={showLeft} onChange={e => setShowLeft(e.target.checked)} />
          Inclure partis
        </label>
        <button className="btn-primary" onClick={() => { resetForm(); setIsEditing(true); }}>+ Personne</button>
      </div>

      {isEditing && (
        <div className="people-form">
          <div className="form-row">
            <input placeholder="Prénom *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input placeholder="Nom" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
          <div className="form-row">
            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input placeholder="Rôle" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
          </div>
          <div className="form-row">
            <select value={form.teamId} onChange={e => setForm(f => ({ ...f, teamId: e.target.value }))}>
              <option value="">Aucune équipe</option>
              {teamsList.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            <label><input type="checkbox" checked={form.left} onChange={e => setForm(f => ({ ...f, left: e.target.checked }))} /> Parti</label>
            <label><input type="checkbox" checked={form.contactOnly} onChange={e => setForm(f => ({ ...f, contactOnly: e.target.checked }))} /> Contact ext.</label>
          </div>
          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          <div className="form-actions">
            {selected
              ? <button className="btn-primary" onClick={handleUpdate}>Enregistrer</button>
              : <button className="btn-primary" onClick={handleCreate}>Créer</button>}
            <button className="btn-secondary" onClick={resetForm}>Annuler</button>
          </div>
        </div>
      )}

      <div className="people-list">
        {persons.map(p => (
          <div key={p._id} className={`person-card ${p.left ? 'left' : ''}`}>
            <div className="person-info">
              <strong>{p.name} {p.lastName}</strong>
              {p.role && <span className="person-role">{p.role}</span>}
              {p.teamId && <span className="person-team">{teamName(p.teamId)}</span>}
              {p.email && <span className="person-email">{p.email}</span>}
              {p.left && <span className="badge badge-left">Parti</span>}
              {p.contactOnly && <span className="badge badge-contact">Contact</span>}
            </div>
            <div className="person-actions">
              <button className="btn-small" onClick={() => startEdit(p)}>Modifier</button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(p._id)}>Supprimer</button>
            </div>
          </div>
        ))}
        {persons.length === 0 && <p className="empty">Aucune personne trouvée</p>}
      </div>
    </div>
  );
}
