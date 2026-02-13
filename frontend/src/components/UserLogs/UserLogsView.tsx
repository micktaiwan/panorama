import { useState, useEffect, useCallback } from 'react';
import { userLogs as api } from '../../services/api';
import type { UserLog } from '../../types';
import './UserLogsView.css';

export function UserLogsView() {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');

  const load = useCallback(async () => {
    const res = await api.list(200);
    setLogs(res.logs);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!input.trim()) return;
    await api.create(input.trim());
    setInput('');
    load();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); }
  };

  const handleUpdate = async () => {
    if (!editingId || !editInput.trim()) return;
    await api.update(editingId, editInput.trim());
    setEditingId(null);
    setEditInput('');
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  const handleClear = async () => {
    if (!confirm('Supprimer tous les logs ?')) return;
    await api.clearAll();
    load();
  };

  const startEdit = (log: UserLog) => {
    setEditingId(log._id);
    setEditInput(log.content);
  };

  // Group by date
  const groups = logs.reduce<Record<string, UserLog[]>>((acc, log) => {
    const day = new Date(log.createdAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    (acc[day] ||= []).push(log);
    return acc;
  }, {});

  return (
    <div className="logs-container">
      <div className="logs-toolbar">
        <h2>Journal</h2>
        {logs.length > 0 && <button className="btn-small btn-danger" onClick={handleClear}>Tout effacer</button>}
      </div>

      <div className="logs-input">
        <input
          placeholder="Qu'avez-vous fait ? (Entrée pour enregistrer)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn-primary" onClick={handleAdd} disabled={!input.trim()}>Ajouter</button>
      </div>

      <div className="logs-timeline">
        {Object.entries(groups).map(([day, dayLogs]) => (
          <div key={day} className="log-day">
            <div className="log-day-header">{day}</div>
            {dayLogs.map(log => (
              <div key={log._id} className="log-entry">
                {editingId === log._id ? (
                  <div className="log-edit">
                    <input value={editInput} onChange={e => setEditInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleUpdate()} />
                    <button className="btn-small btn-primary" onClick={handleUpdate}>OK</button>
                    <button className="btn-small" onClick={() => setEditingId(null)}>Annuler</button>
                  </div>
                ) : (
                  <>
                    <span className="log-time">{new Date(log.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="log-content">{log.content}</span>
                    <div className="log-actions">
                      <button className="btn-tiny" onClick={() => startEdit(log)}>Modifier</button>
                      <button className="btn-tiny btn-danger" onClick={() => handleDelete(log._id)}>X</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
        {logs.length === 0 && <p className="empty">Aucune entrée dans le journal</p>}
      </div>
    </div>
  );
}
