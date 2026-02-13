import { useState, useEffect, useCallback } from 'react';
import { calendar as api } from '../../services/api';
import type { CalendarEvent } from '../../types';
import './CalendarView.css';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getWeekRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() + 1); // Monday
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [range, setRange] = useState(getWeekRange);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ title: '', start: '', end: '', location: '', allDay: false });

  const load = useCallback(async () => {
    const res = await api.list({ from: range.from, to: range.to });
    setEvents(res.events);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const shiftWeek = (delta: number) => {
    setRange(prev => {
      const from = new Date(prev.from);
      from.setDate(from.getDate() + delta * 7);
      const to = new Date(from);
      to.setDate(to.getDate() + 6);
      to.setHours(23, 59, 59, 999);
      return { from: from.toISOString(), to: to.toISOString() };
    });
  };

  const goToday = () => setRange(getWeekRange());

  const handleCreate = async () => {
    if (!form.title.trim() || !form.start || !form.end) return;
    await api.create({
      title: form.title,
      start: new Date(form.start).toISOString(),
      end: new Date(form.end).toISOString(),
      location: form.location,
      allDay: form.allDay,
    });
    setForm({ title: '', start: '', end: '', location: '', allDay: false });
    setIsCreating(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  // Group by day
  const dayGroups = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    const day = new Date(e.start).toISOString().slice(0, 10);
    (acc[day] ||= []).push(e);
    return acc;
  }, {});

  const weekLabel = `${formatDate(range.from)} - ${formatDate(range.to)}`;

  return (
    <div className="calendar-container">
      <div className="calendar-toolbar">
        <h2>Calendrier</h2>
        <div className="calendar-nav">
          <button className="btn-small" onClick={() => shiftWeek(-1)}>&larr;</button>
          <button className="btn-small" onClick={goToday}>Aujourd'hui</button>
          <button className="btn-small" onClick={() => shiftWeek(1)}>&rarr;</button>
          <span className="week-label">{weekLabel}</span>
        </div>
        <button className="btn-primary" onClick={() => setIsCreating(true)}>+ Événement</button>
      </div>

      {isCreating && (
        <div className="calendar-form">
          <input placeholder="Titre *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="form-row">
            <input type="datetime-local" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
            <input type="datetime-local" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />
          </div>
          <div className="form-row">
            <input placeholder="Lieu" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
            <label className="check-label"><input type="checkbox" checked={form.allDay} onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))} /> Journée entière</label>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleCreate}>Créer</button>
            <button className="btn-secondary" onClick={() => setIsCreating(false)}>Annuler</button>
          </div>
        </div>
      )}

      <div className="calendar-days">
        {Object.entries(dayGroups).sort(([a], [b]) => a.localeCompare(b)).map(([day, dayEvents]) => (
          <div key={day} className="calendar-day">
            <div className="day-header">{formatDate(day + 'T00:00:00')}</div>
            {dayEvents.map(evt => (
              <div key={evt._id} className="event-card">
                <div className="event-time">
                  {evt.allDay ? 'Journée' : `${formatTime(evt.start)} - ${formatTime(evt.end)}`}
                </div>
                <div className="event-info">
                  <strong>{evt.title}</strong>
                  {evt.location && <span className="event-location">{evt.location}</span>}
                  {evt.source !== 'manual' && <span className="event-source">{evt.source}</span>}
                </div>
                {evt.source === 'manual' && (
                  <button className="btn-small btn-danger" onClick={() => handleDelete(evt._id)}>X</button>
                )}
              </div>
            ))}
          </div>
        ))}
        {events.length === 0 && <p className="empty">Aucun événement cette semaine</p>}
      </div>
    </div>
  );
}
