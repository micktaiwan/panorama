import { useState, useEffect, useCallback } from 'react';
import { alarms as api } from '../../services/api';
import type { Alarm } from '../../types';
import './AlarmsList.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const recurrenceLabel: Record<string, string> = {
  none: 'Unique',
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
};

export function AlarmsList() {
  const [items, setItems] = useState<Alarm[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ title: '', nextTriggerAt: '', recurrenceType: 'none' as string });

  const load = useCallback(async () => {
    const res = await api.list();
    setItems(res.alarms);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.nextTriggerAt) return;
    await api.create({
      title: form.title,
      nextTriggerAt: new Date(form.nextTriggerAt).toISOString(),
      recurrence: { type: form.recurrenceType as Alarm['recurrence']['type'] },
    });
    setForm({ title: '', nextTriggerAt: '', recurrenceType: 'none' });
    setIsCreating(false);
    load();
  };

  const handleSnooze = async (id: string, minutes: number) => {
    await api.snooze(id, minutes);
    load();
  };

  const handleDismiss = async (id: string) => {
    await api.dismiss(id);
    load();
  };

  const handleToggle = async (alarm: Alarm) => {
    await api.update(alarm._id, { enabled: !alarm.enabled });
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  const isDue = (alarm: Alarm) => {
    if (!alarm.enabled || alarm.done) return false;
    const now = Date.now();
    const trigger = new Date(alarm.nextTriggerAt).getTime();
    const snooze = alarm.snoozedUntilAt ? new Date(alarm.snoozedUntilAt).getTime() : 0;
    return trigger <= now && snooze <= now;
  };

  const active = items.filter(a => a.enabled && !a.done);
  const inactive = items.filter(a => !a.enabled || a.done);

  return (
    <div className="alarms-container">
      <div className="alarms-toolbar">
        <h2>Alarmes</h2>
        <button className="btn-primary" onClick={() => setIsCreating(true)}>+ Alarme</button>
      </div>

      {isCreating && (
        <div className="alarms-form">
          <input placeholder="Titre *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <input type="datetime-local" value={form.nextTriggerAt} onChange={e => setForm(f => ({ ...f, nextTriggerAt: e.target.value }))} />
          <select value={form.recurrenceType} onChange={e => setForm(f => ({ ...f, recurrenceType: e.target.value }))}>
            <option value="none">Unique</option>
            <option value="daily">Quotidien</option>
            <option value="weekly">Hebdomadaire</option>
            <option value="monthly">Mensuel</option>
          </select>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleCreate}>Créer</button>
            <button className="btn-secondary" onClick={() => setIsCreating(false)}>Annuler</button>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="alarms-section">
          <h3>Actives ({active.length})</h3>
          {active.map(alarm => (
            <div key={alarm._id} className={`alarm-card ${isDue(alarm) ? 'due' : ''}`}>
              <div className="alarm-info">
                <strong>{alarm.title}</strong>
                <span className="alarm-time">{formatDate(alarm.nextTriggerAt)}</span>
                <span className="alarm-recurrence">{recurrenceLabel[alarm.recurrence.type]}</span>
                {alarm.snoozedUntilAt && <span className="alarm-snooze">Snooze: {formatDate(alarm.snoozedUntilAt)}</span>}
              </div>
              <div className="alarm-actions">
                {isDue(alarm) && (
                  <>
                    <button className="btn-small" onClick={() => handleSnooze(alarm._id, 5)}>+5m</button>
                    <button className="btn-small" onClick={() => handleSnooze(alarm._id, 15)}>+15m</button>
                    <button className="btn-small btn-primary" onClick={() => handleDismiss(alarm._id)}>OK</button>
                  </>
                )}
                <button className="btn-small" onClick={() => handleToggle(alarm)}>Désactiver</button>
                <button className="btn-small btn-danger" onClick={() => handleDelete(alarm._id)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <div className="alarms-section">
          <h3>Inactives ({inactive.length})</h3>
          {inactive.map(alarm => (
            <div key={alarm._id} className="alarm-card inactive">
              <div className="alarm-info">
                <strong>{alarm.title}</strong>
                <span className="alarm-time">{formatDate(alarm.nextTriggerAt)}</span>
                {alarm.done && <span className="badge badge-done">Terminée</span>}
              </div>
              <div className="alarm-actions">
                {!alarm.done && <button className="btn-small" onClick={() => handleToggle(alarm)}>Activer</button>}
                <button className="btn-small btn-danger" onClick={() => handleDelete(alarm._id)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && <p className="empty">Aucune alarme</p>}
    </div>
  );
}
