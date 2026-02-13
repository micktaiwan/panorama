import { useEffect, useState } from 'react';
import { overview } from '../../services/api';
import type { OverviewData } from '../../types';
import './Dashboard.css';

export function Dashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    overview.get()
      .then(setData)
      .catch(err => console.error('Dashboard load error:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="dashboard-loading">Chargement...</div>;
  if (!data) return <div className="dashboard-error">Erreur de chargement</div>;

  return (
    <div className="dashboard">
      <h2>Tableau de bord</h2>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-value">{data.projects.active}</div>
          <div className="stat-label">Projets actifs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.tasks.todo + data.tasks.inProgress}</div>
          <div className="stat-label">Tâches en cours</div>
        </div>
        <div className="stat-card urgent">
          <div className="stat-value">{data.tasks.urgent}</div>
          <div className="stat-label">Urgentes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.notes.total}</div>
          <div className="stat-label">Notes</div>
        </div>
      </div>

      <div className="dashboard-sections">
        <section>
          <h3>Projets récents</h3>
          {data.projects.recent.length === 0 ? (
            <p className="empty">Aucun projet</p>
          ) : (
            <ul className="recent-list">
              {data.projects.recent.map(p => (
                <li key={p._id}>
                  <span className="recent-name">{p.isFavorite ? '★ ' : ''}{p.name}</span>
                  <span className={`status-badge ${p.status}`}>{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Tâches prioritaires</h3>
          {data.tasks.recent.length === 0 ? (
            <p className="empty">Aucune tâche</p>
          ) : (
            <ul className="recent-list">
              {data.tasks.recent.map(t => (
                <li key={t._id}>
                  <span className="recent-name">
                    {t.urgent && <span className="tag urgent">U</span>}
                    {t.important && <span className="tag important">I</span>}
                    {t.title}
                  </span>
                  <span className={`status-badge ${t.status}`}>{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
